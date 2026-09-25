const assert = require('node:assert/strict');
const { test } = require('node:test');
const { server, state } = require('../server');
const llm = require('./llm');

test('booking API requires preferences, a proposal and contextual agreement before side effects', async (t) => {
  const assess = t.mock.method(llm, 'completeJson', async () => ({ data: { decision: 'accepted' } }));
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?')) {
      return { ok: true, text: async () => JSON.stringify({ signed_url: 'wss://example.invalid/test' }) };
    }
    assert.ok(String(url).startsWith('http://127.0.0.1:'), 'tests must not call external services');
    return nativeFetch(url, options);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(response.status, 200);
    return response.json();
  };
  state.agents = { outreach_en: 'test', outreach_ar: 'test', companion_en: 'test', companion_ar: 'test' };

  for (const role of ['outreach', 'companion']) {
    for (const lang of ['en', 'ar']) {
      await t.test(`${role}/${lang}: no premature booking, then exact approved slot`, async () => {
        await post('/api/reset', {});
        const id = 'P-1001';
        const { sessionId } = await post('/api/session', { id, role, lang });
        const transcript = [{ role: 'agent', message: 'Would you like help arranging a visit?' }, { role: 'user', message: lang === 'ar' ? 'إي' : 'Yes.' }];
        const tool = role === 'outreach' ? 'schedule_visit' : 'book_appointment';
        const action = (tool, params, turns = transcript, session = sessionId) => post('/api/action', { id, tool, params, transcript: turns, sessionId: session });
        const oldRequest = await action(tool, { visit_type: 'Cardiology', preferred_time: 'Saturday evening', specialty: 'Cardiology', urgency: 'soon' });
        assert.equal(oldRequest.blocked, true);
        assert.equal(state.bookings.length, 0);
        const earlyOutcome = await action('log_call_outcome', { outcome: 'booked', notes: 'Member agreed to help.' });
        assert.equal(earlyOutcome.blocked, true);
        assert.equal(state.gapsClosed, 0);
        assert.equal(state.savings, 0);

        transcript.push({ role: 'agent', message: 'What day, time and location do you prefer, and would you like transport help?' }, { role: 'user', message: 'Saturday evening, Al Khalidiyah. Please request transport.' });
        const preferences = { visit_type: 'Cardiology', preferred_time: 'Saturday evening', preferred_location: 'Al Khalidiyah', transport: 'requested' };
        const missingPreference = await action('propose_visit', { ...preferences, preferred_location: '' });
        assert.equal(missingPreference.blocked, true);
        const proposed = await action('propose_visit', preferences);
        assert.equal(proposed.ui.status, 'awaiting_confirmation');
        assert.equal(proposed.ui.time, '18:30');
        assert.equal(state.bookings.length, 0);
        assert.equal(state.events.filter((event) => ['booking', 'outcome'].includes(event.type)).length, 0);
        assert.equal(state.gapsClosed, 0);
        const params = { proposal_id: proposed.ui.proposalId, patient_confirmation: lang === 'ar' ? 'الموعد يناسبني، بشوفكم هناك' : 'That works for me, see you then.' };
        assert.equal((await action(tool, params)).blocked, true);
        const question = lang === 'ar' ? 'موعد القلب يوم السبت الساعة ست ونص المسا بعيادة رفيق بالخالدية. طلب المواصلات يحتاج تأكيد منفصل. تباني أحجز لك هالموعد؟' : 'The cardiology visit is Saturday at 18:30 at Rafeeq Care clinic, Al Khalidiyah. Transport is only requested, not arranged. Shall I book this appointment?';
        transcript.push({ role: 'agent', message: question }, { role: 'user', message: params.patient_confirmation });
        assess.mock.mockImplementationOnce(async () => ({ data: { decision: 'unclear' } }));
        assert.equal((await action(tool, params)).blocked, true);
        assert.equal(state.bookings.length, 0);
        assert.equal(state.gapsClosed, 0);
        assess.mock.mockImplementationOnce(async () => null);
        assert.equal((await action(tool, params)).blocked, true);
        assert.equal(state.bookings.length, 0);
        const booked = await action(tool, params);
        const assessment = JSON.parse(assess.mock.calls.at(-1).arguments[1]);
        assert.equal(assessment.conversation.at(-1).message, params.patient_confirmation);
        assert.equal(assessment.proposal.proposalId, proposed.ui.proposalId);
        assert.equal(booked.blocked, undefined);
        assert.equal(booked.ui.date, proposed.ui.date);
        assert.equal(booked.ui.time, proposed.ui.time);
        assert.equal(booked.ui.location, proposed.ui.location);
        assert.equal(booked.ui.transport, 'requested_pending_confirmation');
        assert.match(booked.say, /not arranged/);
        assert.equal(state.bookings.length, 1);
        assert.equal(state.gapsClosed, 1);
        assert.equal(state.events.filter((event) => event.type === 'booking').length, 1);
        assert.equal(state.preauths.length, 0);
        assert.deepEqual(state.visitPreps, {});
        assert.equal((await action(tool, params)).blocked, true);
        assert.equal(state.bookings.length, 1);
        const { sessionId: otherSession } = await post('/api/session', { id, role, lang });
        assert.equal((await action('log_call_outcome', { outcome: 'booked', notes: 'Reusing an old booking.' }, transcript, otherSession)).blocked, true);
        if (role === 'outreach') {
          assert.equal((await action('log_call_outcome', { outcome: 'booked', notes: 'Confirmed the proposed appointment; transport still pending.' })).ui.outcome, 'booked');
        }
      });
    }
  }
});
