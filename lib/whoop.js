// WHOOP OAuth (authorization-code flow). The privacy page WHOOP requires is web/privacy.html.
// Tokens live in memory only, like the rest of the demo state, and are gone on restart.

const crypto = require('crypto');

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

const pending = new Map(); // state -> created at (ms); WHOOP requires a state of 8+ characters
let tokens = null;         // { access_token, refresh_token, expires_at, scope }

// Behind Render's proxy the public scheme/host come from forwarding headers.
function redirectUri(req) {
  if (process.env.WHOOP_REDIRECT_URI) return process.env.WHOOP_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}/whoop/callback`;
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:32px 16px;color:#1a1a1a;background:#fff}h1{font-size:28px}h2{font-size:18px;margin-top:28px}a{color:#c8102e}</style></head><body>${body}</body></html>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function connectUrl(req) {
  const clientId = process.env.WHOOP_CLIENT_ID;
  if (!clientId) return null;
  const state = crypto.randomBytes(12).toString('hex');
  pending.set(state, Date.now());
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri(req), scope: SCOPES, state });
  return `${AUTH_URL}?${q}`;
}

// Returns { status, html } for the callback page.
async function handleCallback(req, url) {
  const err = url.searchParams.get('error');
  if (err) return { status: 400, html: page('WHOOP not connected', `<h1>WHOOP not connected</h1><p>${esc(url.searchParams.get('error_description') || err)}</p>`) };
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const started = pending.get(state);
  pending.delete(state);
  if (!code || !started || Date.now() - started > 10 * 60 * 1000) {
    return { status: 400, html: page('WHOOP not connected', '<h1>WHOOP not connected</h1><p>This link is invalid or expired. <a href="/whoop/connect">Try again</a>.</p>') };
  }
  const { WHOOP_CLIENT_ID: id, WHOOP_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return { status: 500, html: page('WHOOP not configured', '<h1>WHOOP not configured</h1><p>Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET on the server.</p>') };

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: id, client_secret: secret, redirect_uri: redirectUri(req) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('WHOOP token exchange failed:', res.status, json);
    return { status: 502, html: page('WHOOP not connected', `<h1>WHOOP not connected</h1><p>Token exchange failed (${res.status}).</p>`) };
  }
  tokens = { access_token: json.access_token, refresh_token: json.refresh_token, scope: json.scope, expires_at: Date.now() + (json.expires_in || 0) * 1000 };
  console.log('WHOOP connected; scopes:', json.scope);
  return { status: 200, html: page('WHOOP connected', '<h1>WHOOP connected</h1><p>Rafeeq can now read your WHOOP data. You can close this tab.</p><p><a href="/">Back to Rafeeq</a></p>') };
}

const status = () => ({ configured: !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET), connected: !!tokens, scope: tokens && tokens.scope });

module.exports = { connectUrl, handleCallback, status };
