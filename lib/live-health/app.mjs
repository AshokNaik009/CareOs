import express from 'express';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createWhoopClient, AppError, SCOPES } from './whoop.mjs';
import { buildReport } from './analysis.mjs';
import { dateInZone, normalize } from './normalize.mjs';

const SESSION_AGE = 86400000;
const cookieName = 'rafeeq_whoop_session';
const basePath = '/live-health';

export function createApp({ origin = 'http://localhost:3000', clientId = '', clientSecret = '', production = false, pageFile, fetchImpl = fetch, now = Date.now } = {}) {
  const app = express();
  const router = express.Router();
  const sessions = new Map();
  const parsedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.pathname !== '/') throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path.');
  origin = parsedOrigin.origin;
  const secure = parsedOrigin.protocol === 'https:';
  if (production && !secure) throw new Error('Production requires an HTTPS APP_ORIGIN.');
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: basePath, maxAge: SESSION_AGE };
  const configured = Boolean(clientId && clientSecret);
  const whoop = createWhoopClient({ clientId, clientSecret, redirectUri: `${origin}${basePath}/auth/whoop/callback`, fetchImpl, now });
  const clearExpired = () => { for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id); };
  const cleanup = setInterval(clearExpired, 60000);
  cleanup.unref();
  app.locals.dispose = () => { clearInterval(cleanup); sessions.clear(); };
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: production ? { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"] } } : false, strictTransportSecurity: secure ? undefined : false }));
  app.use(basePath, router);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const cookie = (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`));
    req.sessionId = cookie?.slice(cookieName.length + 1);
    const session = sessions.get(req.sessionId);
    req.session = session?.expiresAt > now() ? session : null;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Origin') !== origin) return res.status(403).json({ error: 'This request must come from the app’s configured origin.' });
    next();
  });
  router.use(express.json({ limit: '16kb' }));

  router.get('/api/session', (req, res) => res.json({ configured, connected: Boolean(req.session?.tokens) }));
  router.get('/auth/whoop', (req, res) => {
    if (!configured) return res.redirect(`${basePath}?connection=not_configured`);
    clearExpired();
    if (sessions.size >= 1000) throw new AppError(503, 'Please try connecting again later.');
    if (req.sessionId) sessions.delete(req.sessionId);
    const id = randomBytes(32).toString('base64url');
    const state = randomBytes(6).toString('base64url');
    sessions.set(id, { state, expiresAt: now() + 600000 });
    res.cookie(cookieName, id, { ...cookieOptions, maxAge: 600000 });
    const url = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: `${origin}${basePath}/auth/whoop/callback`, response_type: 'code', scope: SCOPES, state }).toString();
    res.redirect(url.toString());
  });
  router.get('/auth/whoop/callback', async (req, res) => {
    const state = req.query.state;
    const expected = req.session?.state;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(state) || !expected || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return res.redirect(`${basePath}?connection=invalid_state`);
    delete req.session.state;
    if (req.query.error || typeof req.query.code !== 'string' || req.query.code.length > 4096) {
      sessions.delete(req.sessionId);
      res.clearCookie(cookieName, cookieOptions);
      return res.redirect(`${basePath}?connection=denied`);
    }
    try {
      const tokens = await whoop.exchange(req.query.code);
      if (sessions.get(req.sessionId) !== req.session || req.session.expiresAt <= now()) return res.redirect(`${basePath}?connection=invalid_state`);
      sessions.delete(req.sessionId);
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { tokens, expiresAt: now() + SESSION_AGE });
      res.cookie(cookieName, id, cookieOptions);
      res.redirect(basePath);
    } catch {
      sessions.delete(req.sessionId);
      res.clearCookie(cookieName, cookieOptions);
      res.redirect(`${basePath}?connection=failed`);
    }
  });

  async function report(req, res) {
    if (!req.session?.tokens) throw new AppError(401, 'Connect your WHOOP account to see your daily analysis.');
    const { timeZone, profile = {} } = req.body ?? {};
    if (typeof timeZone !== 'string' || timeZone.length > 100) throw new AppError(400, 'Provide a valid time zone.');
    try { new Intl.DateTimeFormat('en-CA', { timeZone }).format(); } catch { throw new AppError(400, 'Provide a valid time zone.'); }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || (profile.age != null && (!Number.isInteger(profile.age) || profile.age < 1 || profile.age > 120)) || (profile.sex != null && !['female', 'male', 'other', 'unspecified'].includes(profile.sex)) || (profile.goal != null && !['balanced', 'performance', 'recovery'].includes(profile.goal))) throw new AppError(400, 'Provide a valid age, sex, and training goal.');
    const data = await whoop.data(req.session);
    if (sessions.get(req.sessionId) !== req.session || req.session.expiresAt <= now()) throw new AppError(401, 'Your session ended. Please reconnect your WHOOP account.');
    const result = buildReport(normalize(data, timeZone), dateInZone(now(), timeZone), profile);
    res.json(req.path === '/api/analysis' ? result.analysis : { ...result, timeZone, fetched_at: data.fetchedAt });
  }
  router.post('/api/report', report);
  router.post('/api/analysis', report);
  router.post('/api/logout', (req, res) => {
    sessions.delete(req.sessionId);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  router.post('/api/disconnect', async (req, res) => {
    if (req.session?.tokens) await whoop.revoke(req.session);
    sessions.delete(req.sessionId);
    res.clearCookie(cookieName, cookieOptions);
    res.json({ ok: true });
  });
  if (pageFile) router.get(['/', '/index.html'], (req, res) => res.sendFile(pageFile));
  app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof AppError ? error.status : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ error: error instanceof AppError ? error.message : status === 400 ? 'Invalid JSON body.' : status === 413 ? 'Request body is too large.' : 'The request could not be completed. Please try again.' });
  });
  return app;
}
