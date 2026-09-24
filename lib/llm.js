// Text inference chain for non-voice AI (call notes, pre-call briefs).
// Tries providers in LLM_PROVIDERS order; callers supply an offline fallback if all fail.

const PROVIDERS = {
  groq: () => process.env.GROQ_API_KEY && {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY,
    body: { model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', response_format: { type: 'json_object' }, max_completion_tokens: 2000 },
  },
  openrouter: () => process.env.OPENROUTER_API_KEY && {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY,
    body: {
      model: process.env.OPENROUTER_MODEL || 'minimax/minimax-m3',
      max_tokens: 2000,
      ...(process.env.OPENROUTER_PROVIDER_ORDER ? { provider: { order: process.env.OPENROUTER_PROVIDER_ORDER.split(',').map((s) => s.trim()) } } : {}),
    },
  },
};

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Returns { data, provider } or null when every provider failed.
async function completeJson(system, user, { timeoutMs = 20000 } = {}) {
  const order = (process.env.LLM_PROVIDERS || 'groq,openrouter').split(',').map((s) => s.trim()).filter(Boolean);
  for (const name of order) {
    const cfg = PROVIDERS[name] && PROVIDERS[name]();
    if (!cfg) continue;
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cfg.body, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      const data = parseJson(json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content);
      if (!data) throw new Error('response was not JSON');
      return { data, provider: `${name}:${cfg.body.model}` };
    } catch (e) {
      console.warn(`LLM ${name} failed: ${e.message}`);
    }
  }
  return null;
}

module.exports = { completeJson };
