const API = 'https://api.prod.whoop.com/developer/v2';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createWhoopClient({ clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now }) {
  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new AppError(502, 'WHOOP could not be reached. Please try again.');
    }
    if (response.status === 429) throw new AppError(429, 'WHOOP’s request limit was reached. Wait a little before syncing again.');
    return response;
  }

  async function token(parameters) {
    const response = await request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret }) });
    if (!response.ok) throw new AppError(response.status === 400 || response.status === 401 ? 401 : 502, 'WHOOP authorization could not be renewed. Please reconnect your account.');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new AppError(502, 'WHOOP returned an incomplete authorization response.');
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: now() + data.expires_in * 1000 };
  }

  async function refresh(session) {
    if (!session.refreshing) {
      if (!session.tokens?.refreshToken) throw new AppError(401, 'Please reconnect your WHOOP account.');
      session.refreshing = token({ grant_type: 'refresh_token', refresh_token: session.tokens.refreshToken, scope: 'offline' })
        .then(tokens => { session.tokens = { ...tokens, refreshToken: tokens.refreshToken ?? session.tokens.refreshToken }; })
        .finally(() => { session.refreshing = null; });
    }
    await session.refreshing;
  }

  async function authorized(session, path, options = {}) {
    if (!session.tokens) throw new AppError(401, 'Connect your WHOOP account first.');
    if (session.tokens.expiresAt <= now() + 60000) await refresh(session);
    const usedToken = session.tokens.accessToken;
    let response = await request(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${usedToken}` } });
    if (response.status === 401) {
      if (session.tokens.accessToken === usedToken) await refresh(session);
      response = await request(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${session.tokens.accessToken}` } });
    }
    if (!response.ok) throw new AppError(response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403 ? 'Your WHOOP access expired or lacks the required permissions. Please reconnect.' : 'WHOOP could not return all your data. Please try again.');
    return response;
  }

  async function collection(session, path, start, end) {
    const records = [];
    const seen = new Set();
    let nextToken;
    do {
      const query = new URLSearchParams({ limit: '25', start, end });
      if (nextToken) query.set('nextToken', nextToken);
      const response = await authorized(session, `${path}?${query}`);
      const page = await response.json();
      if (!Array.isArray(page.records)) throw new AppError(502, 'WHOOP returned an unexpected data format.');
      records.push(...page.records);
      nextToken = page.next_token;
      if (nextToken && (typeof nextToken !== 'string' || seen.has(nextToken) || seen.size >= 100)) throw new AppError(502, 'WHOOP returned an incomplete data history. Please try again.');
      seen.add(nextToken);
    } while (nextToken);
    return records;
  }

  return {
    exchange: code => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    async userId(session) {
      const profile = await (await authorized(session, '/user/profile/basic')).json();
      if (!Number.isSafeInteger(profile.user_id) || profile.user_id <= 0) throw new AppError(502, 'WHOOP could not identify your account for alerts. Please reconnect.');
      return profile.user_id;
    },
    async data(session) {
      if (session.cache && session.cache.expiresAt > now()) return session.cache.data;
      if (!session.loading) {
        const end = new Date(now()).toISOString();
        const start = new Date(now() - 33 * 86400000).toISOString();
        session.loading = Promise.all([
          collection(session, '/cycle', start, end),
          collection(session, '/recovery', start, end),
          collection(session, '/activity/sleep', start, end),
          collection(session, '/activity/workout', start, end),
        ]).then(([cycles, recoveries, sleeps, workouts]) => {
          const data = { cycles, recoveries, sleeps, workouts, fetchedAt: new Date(now()).toISOString() };
          session.cache = { data, expiresAt: now() + 60000 };
          return data;
        }).finally(() => { session.loading = null; });
      }
      return session.loading;
    },
    revoke: session => authorized(session, '/user/access', { method: 'DELETE' }),
  };
}
