const assert = require('node:assert/strict');
const { test } = require('node:test');
const llm = require('./llm');
const { createBookingFlow, assessBookingAgreement, BookingError } = require('./booking');

const preferences = { visit_type: 'Heart failure review', preferred_time: 'Saturday evening', preferred_location: 'Al Khalidiyah', transport: 'not_needed' };
const before = [
  { role: 'agent', message: 'Would you like help booking a visit?' },
  { role: 'user', message: 'Yes.' },
  { role: 'agent', message: 'Which day, time and area work for you, and do you need transport?' },
  { role: 'user', message: 'Saturday evening in Al Khalidiyah. I have my own transport.' },
];
const question = { role: 'agent', message: 'The heart failure review is Saturday 3 October at 18:30 at Rafeeq Care clinic, Al Khalidiyah, with no copay and no transport request. Does that work for you?' };
const slot = () => ({ date: '2026-10-03', dateLabel: 'Saturday, 3 October', time: '18:30' });

function setup(role = 'outreach', assessAgreement = async () => 'accepted') {
  let now = 1000;
  const flow = createBookingFlow({ slot, now: () => now, assessAgreement });
  const sessionId = flow.createSession('P-1001', role);
  const proposal = flow.propose(sessionId, 'P-1001', preferences, before);
  const confirm = (reply, transcript = [...before, question, { role: 'user', message: reply }], proposalId = proposal.proposalId) => flow.confirm(sessionId, 'P-1001', role === 'outreach' ? 'schedule_visit' : 'book_appointment', { proposal_id: proposalId, patient_confirmation: reply }, transcript);
  return { flow, sessionId, proposal, confirm, advance: () => { now += 61 * 60 * 1000; } };
}

for (const role of ['outreach', 'companion']) {
  for (const reply of ['Yes.', 'نعم', 'إي', 'That works for me.', 'See you then.', 'Consider it a date, I will be there.', 'Can you put me down for that?', 'الموعد يناسبني', 'على بركة الله', 'خلاص بشوفكم هناك']) {
    test(`${role} accepts contextual agreement with or without yes/نعم: ${reply}`, async (t) => {
      const assess = t.mock.fn(async () => 'accepted');
      const { confirm, proposal } = setup(role, assess);
      const result = await confirm(reply);
      assert.equal(result.patientConfirmation, reply);
      assert.equal(result.date, proposal.date);
      assert.equal(result.time, proposal.time);
      assert.equal(result.location, proposal.location);
      assert.deepEqual(assess.mock.calls[0].arguments[0], { proposal, transcript: [question, { role: 'user', message: reply }] });
    });
  }
}

test('proposing a visit collects preferences without booking or arranging transport', () => {
  const { proposal } = setup();
  assert.equal(proposal.status, 'awaiting_confirmation');
  assert.deepEqual(proposal.preferences, preferences);
  assert.equal(proposal.transport, 'not_requested');
  assert.equal(proposal.ref, undefined);
});

for (const field of ['visit_type', 'preferred_time', 'preferred_location', 'transport']) {
  test(`cannot propose a visit without ${field}`, () => {
    const { flow, sessionId } = setup();
    assert.throws(() => flow.propose(sessionId, 'P-1001', { ...preferences, [field]: '' }, before), BookingError);
  });
}

for (const [reply, decision] of [
  ['No.', 'declined'], ['لا', 'declined'], ['Yes, but Monday instead.', 'change_requested'], ['إي بس غير المكان', 'change_requested'],
  ['Maybe', 'unclear'], ['Not sure', 'unclear'], ['Mouth slide.', 'unclear'], ['كم التكلفة؟', 'unclear'], ['', 'unclear'],
]) {
  test(`does not book when contextual assessment returns ${decision}: ${reply}`, async () => {
    const { confirm } = setup('outreach', async () => decision);
    await assert.rejects(() => confirm(reply), BookingError);
  });
}

test('the initial yes and a tool-supplied confirmation cannot replace a new patient turn', async (t) => {
  const assess = t.mock.fn(async () => 'accepted');
  const { confirm } = setup('outreach', assess);
  await assert.rejects(() => confirm('Yes.', before), BookingError);
  await assert.rejects(() => confirm('Yes.', [...before, { role: 'user', message: 'Yes.' }]), BookingError);
  await assert.rejects(() => confirm('Yes.', [...before, question, { role: 'user', message: 'No.' }]), BookingError);
  await assert.rejects(() => confirm('Yes.', [...before, question, { role: 'user', message: 'That works for me.' }]), BookingError);
  assert.equal(assess.mock.callCount(), 0);
});

test('a yes to a different question does not override the contextual assessment', async (t) => {
  const assess = t.mock.fn(async () => 'unclear');
  const { confirm } = setup('outreach', assess);
  const turns = [question, { role: 'agent', message: 'Do you need more time to decide?' }, { role: 'user', message: 'Yes.' }];
  await assert.rejects(() => confirm('Yes.', [...before, ...turns]), BookingError);
  assert.deepEqual(assess.mock.calls[0].arguments[0].transcript, turns);
});

test('unresolved changes are assessed from the whole exchange, not just the final yes', async (t) => {
  const assess = t.mock.fn(async () => 'change_requested');
  const { confirm } = setup('outreach', assess);
  const turns = [question, { role: 'user', message: 'Morning instead.' }, { role: 'agent', message: 'Morning, then?' }, { role: 'user', message: 'Yes.' }];
  await assert.rejects(() => confirm('Yes.', [...before, ...turns]), BookingError);
  assert.deepEqual(assess.mock.calls[0].arguments[0].transcript, turns);
  await assert.rejects(() => confirm('Yes.'), BookingError);
});

test('an unclear reply can be clarified naturally without a mandatory yes', async () => {
  let decision = 'unclear';
  const { confirm } = setup('outreach', async () => decision);
  const turns = [...before, question, { role: 'user', message: 'Where was that again?' }];
  await assert.rejects(() => confirm('Where was that again?', turns), BookingError);
  decision = 'accepted';
  turns.push({ role: 'agent', message: 'Al Khalidiyah, as proposed. Does that work for you?' }, { role: 'user', message: 'See you there.' });
  assert.equal((await confirm('See you there.', turns)).status, 'confirmed');
});

test('a changed transcript cannot reuse confirmation history', async () => {
  const { confirm } = setup();
  await assert.rejects(() => confirm('Yes.', [{ role: 'user', message: 'Different history' }, ...before.slice(1), question, { role: 'user', message: 'Yes.' }]), BookingError);
});

test('a revised proposal invalidates the previous option and requires another response', async () => {
  const { flow, sessionId, proposal, confirm } = setup();
  const changed = [...before, question, { role: 'user', message: 'Morning instead, please.' }];
  const revised = flow.propose(sessionId, 'P-1001', { ...preferences, preferred_time: 'Saturday morning' }, changed);
  assert.notEqual(revised.proposalId, proposal.proposalId);
  await assert.rejects(() => confirm('Yes.'), BookingError);
  await assert.rejects(() => confirm('Morning instead, please.', changed, revised.proposalId), BookingError);
});

test('proposals cannot be used across sessions, patients, tools, or after expiry', async () => {
  const { flow, sessionId, proposal, advance, confirm } = setup();
  const params = { proposal_id: proposal.proposalId, patient_confirmation: 'Yes.' };
  const transcript = [...before, question, { role: 'user', message: 'Yes.' }];
  const otherSession = flow.createSession('P-1001', 'outreach');
  await assert.rejects(() => flow.confirm(otherSession, 'P-1001', 'schedule_visit', params, transcript), BookingError);
  await assert.rejects(() => flow.confirm(sessionId, 'P-1002', 'schedule_visit', params, transcript), BookingError);
  await assert.rejects(() => flow.confirm(sessionId, 'P-1001', 'book_appointment', params, transcript), BookingError);
  advance();
  await assert.rejects(() => confirm('Yes.'), BookingError);
});

test('transport is only a request and never described as arranged', () => {
  const { flow, sessionId } = setup();
  const proposal = flow.propose(sessionId, 'P-1001', { ...preferences, transport: 'requested' }, before);
  assert.equal(proposal.transport, 'requested_pending_confirmation');
  assert.match(proposal.transportDetails, /not arranged/i);
});

test('a proposal can only be confirmed once and reset invalidates sessions', async () => {
  const { flow, confirm } = setup();
  await confirm('Yes.');
  await assert.rejects(() => confirm('Yes.'), BookingError);
  flow.clear();
  await assert.rejects(() => confirm('Yes.'), BookingError);
});

test('concurrent confirmations cannot book twice', async () => {
  let resolve;
  const { confirm } = setup('outreach', () => new Promise((r) => { resolve = r; }));
  const first = confirm('That works.');
  await assert.rejects(() => confirm('That works.'), /already being checked/);
  resolve('accepted');
  assert.equal((await first).status, 'confirmed');
});

for (const change of ['proposal', 'reset', 'expiry']) {
  test(`in-flight inference cannot book after ${change} changes`, async () => {
    let resolve;
    const { flow, sessionId, confirm, advance } = setup('outreach', () => new Promise((r) => { resolve = r; }));
    const pending = confirm('That works.');
    if (change === 'proposal') flow.propose(sessionId, 'P-1001', { ...preferences, preferred_time: 'Morning' }, before);
    else if (change === 'reset') flow.clear();
    else advance();
    resolve('accepted');
    await assert.rejects(pending, BookingError);
  });
}

for (const decision of ['unavailable', 'unexpected', null]) {
  test(`failed or invalid inference never authorizes a booking: ${decision}`, async () => {
    const { confirm } = setup('outreach', async () => decision);
    await assert.rejects(() => confirm('That works.'), BookingError);
  });
}

test('the semantic assessment receives the exact proposal and conversation, with a bounded timeout', async (t) => {
  const complete = t.mock.method(llm, 'completeJson', async () => ({ data: { decision: 'accepted' } }));
  const { proposal } = setup();
  const transcript = [question, { role: 'user', message: 'الموعد يناسبني' }];
  assert.equal(await assessBookingAgreement({ proposal, transcript }), 'accepted');
  const [system, user, options] = complete.mock.calls[0].arguments;
  assert.match(system, /literal yes or نعم is NOT required/);
  assert.match(system, /not an exhaustive phrase list/);
  assert.match(system, /untrusted data/);
  assert.deepEqual(JSON.parse(user), { proposal, conversation: transcript });
  assert.ok(options.timeoutMs < 10000);
});

for (const [response, expected] of [[null, 'unavailable'], [{ data: {} }, 'unclear'], [{ data: { decision: true } }, 'unclear'], [{ data: { decision: 'declined' } }, 'declined']]) {
  test(`semantic inference validates provider response: ${JSON.stringify(response)}`, async (t) => {
    t.mock.method(llm, 'completeJson', async () => response);
    assert.equal(await assessBookingAgreement({ proposal: {}, transcript: [] }), expected);
  });
}
