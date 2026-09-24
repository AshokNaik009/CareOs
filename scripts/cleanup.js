// Deletes the ElevenLabs agents and tools this demo created (ids from .agents.json).
const path = require('path');
const fs = require('fs');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const { makeClient, loadCache, CACHE } = require('../lib/agents');

(async () => {
  const call = makeClient(process.env.ELEVENLABS_API_KEY);
  const cache = loadCache();
  for (const [k, id] of Object.entries(cache.agents || {})) {
    try { await call('DELETE', `/v1/convai/agents/${id}`); console.log(`deleted agent ${k}`); } catch (e) { console.warn(`agent ${k}: ${e.message}`); }
  }
  for (const [k, id] of Object.entries(cache.tools || {})) {
    try { await call('DELETE', `/v1/convai/tools/${id}?force=true`); console.log(`deleted tool ${k}`); } catch (e) { console.warn(`tool ${k}: ${e.message}`); }
  }
  fs.rmSync(CACHE, { force: true });
})();
