const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { ensureAgents, CACHE, TOOLS, AGENT_SPECS, PROMPT, arabicPrompt } = require('./agents');

for (const spec of AGENT_SPECS) {
  test(`${spec.key} requires a proposal and separate booking consent`, () => {
    assert.ok(spec.tools.includes('propose_visit'));
    const tool = TOOLS[spec.role === 'outreach' ? 'schedule_visit' : 'book_appointment'];
    assert.deepEqual(tool.required, ['proposal_id', 'patient_confirmation']);
    const prompt = PROMPT[spec.lang][spec.role];
    assert.match(prompt, /propose_visit/);
    assert.match(prompt, /patient_confirmation/);
    assert.match(prompt, spec.lang === 'en' ? /one question at a time and WAIT/ : /سؤال واحد كل مرة/);
    assert.match(prompt, spec.lang === 'en' ? /NOT arranged/ : /مب مواصلات مرتبة/);
    assert.match(prompt, spec.lang === 'en' ? /No literal yes or نعم is required/ : /مب لازم يقول «نعم» أو «إي» حرفيا/);
    assert.doesNotMatch(prompt, /WAIT for a new explicit yes|Always get a clear yes/);
    assert.match(tool.description, /implied acceptance is sufficient/);
  });
}

test('every Arabic writing mode preserves the confirmation flow', () => {
  for (const role of ['outreach', 'companion']) {
    for (const mode of ['harakat', 'plain', 'selective']) {
      assert.match(arabicPrompt(role, mode), /proposal_id/);
      assert.match(arabicPrompt(role, mode), /افهم الموافقة من معنى رده وسياق الكلام/);
    }
  }
  assert.deepEqual(TOOLS.propose_visit.required, ['visit_type', 'preferred_time', 'preferred_location', 'transport']);
});

for (const llm of ['claude-haiku-4-5', 'gpt-4o']) {
  for (const override of [undefined, '', 'gpt-4.1']) {
    test(`agent models: default=${llm}, Arabic=${JSON.stringify(override)}`, async (t) => {
      const original = process.env.AGENT_LLM_AR;
      t.after(() => {
        if (original === undefined) delete process.env.AGENT_LLM_AR;
        else process.env.AGENT_LLM_AR = original;
      });
      if (override === undefined) delete process.env.AGENT_LLM_AR;
      else process.env.AGENT_LLM_AR = override;

      let cache = JSON.stringify({ tools: {}, agents: {} });
      const requests = [];
      t.mock.method(fs, 'readFileSync', (file) => {
        assert.equal(file, CACHE);
        return cache;
      });
      t.mock.method(fs, 'writeFileSync', (file, content) => {
        assert.equal(file, CACHE);
        cache = content;
      });
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        const body = JSON.parse(options.body);
        if (url.includes('/convai/agents/')) requests.push({ method: options.method, config: body.conversation_config });
        return { ok: true, text: async () => JSON.stringify({ id: `tool-${body.tool_config?.name}`, agent_id: `agent-${body.name}` }) };
      });

      for (const method of ['POST', 'PATCH']) {
        requests.length = 0;
        await ensureAgents('test-key', llm, () => {});
        assert.equal(requests.length, 4);
        assert.equal(requests.filter(({ config }) => config.agent.language === 'ar').length, 2);
        assert.equal(requests.filter(({ config }) => config.agent.language === 'en').length, 2);
        for (const request of requests) {
          assert.equal(request.method, method);
          const { agent } = request.config;
          assert.equal(agent.prompt.llm, agent.language === 'ar' ? override || llm : llm);
        }
      }
    });
  }
}
