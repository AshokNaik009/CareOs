// JSON helpers for the demo server. Errors carry the server's { error } message.
async function request(url, init) {
  const r = await fetch(url, init);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export const api = {
  get: (url) => request(url),
  post: (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
};
