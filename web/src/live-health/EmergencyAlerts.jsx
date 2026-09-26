import { useEffect, useState } from 'react';
import { ALERT_RULES, emptyPreferences, ALERT_AGENT_PROMPT } from '../../../lib/live-health/alert-rules.mjs';

const eventLabels = { submitting: 'Requesting call', submitted: 'Submitted to Twilio · delivery not confirmed', ringing: 'Contact phone ringing', in_progress: 'Call in progress', ended: 'Call ended · contact acknowledgement not verified', not_reached: 'Contact not reached', failed: 'Call request failed · no automatic retry', delivery_unknown: 'Delivery unknown · no automatic retry', cooldown: 'Call suppressed · 24-hour limit' };
const voiceLabels = { connecting: 'Connecting the AI voice agent', connected: 'Voice bridge returned · conversation delivery not verified', declined: 'Recipient did not agree to continue', failed: 'Voice agent connection failed' };

function Illustration({ icon }) {
  return <svg className={`lh-alert-art lh-alert-art-${icon}`} viewBox="0 0 240 104" fill="none" aria-hidden="true">
    <circle className="lh-art-halo" cx="120" cy="52" r="44" />
    <path className="lh-art-grid" d="M20 26h200M20 52h200M20 78h200M60 12v80M100 12v80M140 12v80M180 12v80" />
    <g className="lh-art-line" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {icon === 'heart' && <><path d="M120 78S86 59 86 39c0-18 24-23 34-7 10-16 34-11 34 7 0 20-34 39-34 39Z" /><path d="M52 53h49l8-13 12 29 11-19 7 3h49" /></>}
      {icon === 'oxygen' && <><path d="M120 15s-27 29-27 47a27 27 0 0 0 54 0c0-18-27-47-27-47Z" /><circle cx="114" cy="56" r="8" /><path d="M130 62c8-8 12 1 5 5l-5 4h10" /><path d="M63 40h12m-6-6v12m96 19h12m-6-6v12" /></>}
      {icon === 'lungs' && <><path d="M115 18v31L98 65m27-47v31l17 16M108 32c-14-19-33 14-33 40 0 20 29 13 33-1V32Zm24 0c14-19 33 14 33 40 0 20-29 13-33-1V32Z" /><path d="M93 49v22m54-22v22" /></>}
      {icon === 'recovery' && <><circle cx="120" cy="52" r="30" /><path d="m124 31-17 24h15l-5 19 18-26h-15l4-17ZM75 27l-9-5m99 5 9-5M68 52H57m115 0h11M75 77l-9 5m99-5 9 5" /></>}
      {icon === 'pressure' && <><circle cx="115" cy="46" r="27" /><path d="m115 46 12-14m-29 13h4m12-17v4m17 13h-4M115 73v8c0 15 42 15 42-2V59h16v23h-16M157 65h16" /><circle cx="115" cy="46" r="3" /></>}
    </g>
  </svg>;
}

export default function EmergencyAlerts({ connected, api, mockRest = false }) {
  const [draft, setDraft] = useState(emptyPreferences);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let initial = true;
    const load = async () => {
      try {
        const data = await api('/api/alerts', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setStatus(data);
        setError('');
        if (initial) { setDraft(data.preferences); initial = false; setDirty(false); }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e.message);
        if (e.status === 401) { setExpired(true); setStatus(null); setDraft(emptyPreferences()); }
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [connected, api, attempt]);

  const update = values => { setDraft(current => ({ ...current, ...values })); setDirty(true); setMessage(''); };
  const contact = (field, value) => update({ contact: { ...draft.contact, [field]: value } });
  const toggle = id => {
    const rules = { ...draft.rules };
    if (Object.hasOwn(rules, id)) delete rules[id];
    else rules[id] = '';
    update({ rules });
  };

  async function save(event) {
    event.preventDefault();
    if (draft.enabled && !window.confirm(`Enable automated AI calls from Rafeeq to ${draft.contact.name} at ${draft.contact.phone} when a new WHOOP reading meets a selected threshold? This shares your name and the matched readings with Twilio, ElevenLabs, and your contact.`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api('/api/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, rules: Object.fromEntries(Object.entries(draft.rules).map(([id, value]) => [id, Number(value)])) }) });
      setStatus(data); setDraft(data.preferences); setDirty(false);
      setMessage(data.preferences.enabled ? 'Saved. Only readings measured after this save can trigger a call.' : 'Saved. Automatic calls are off.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function pause() {
    setBusy(true); setError('');
    try {
      const data = await api('/api/alerts/pause', { method: 'POST' });
      setStatus(data); setDraft(data.preferences); setDirty(false); setMessage('Automatic calls paused. A call already submitted to Twilio cannot be cancelled here.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const enabled = status?.preferences.enabled;
  const locked = !connected || expired || !status || busy;
  return <section className="card lh-alerts" id="emergency-alerts" aria-labelledby="lh-alerts-title">
    <header className="lh-alerts-heading">
      <div><p className="label">Your circle of care</p><h2 className="lh-display-title" id="lh-alerts-title">A little backup.<br /><span>Someone you trust.</span></h2><p>Choose the signals that matter. If a new WHOOP reading meets your threshold, Rafeeq can call your emergency contact for a check-in.</p></div>
      <div className={`lh-alert-state ${enabled ? 'lh-alert-state-on' : ''}`}><span className="label">Rafeeq × Twilio</span><strong>{expired ? 'Session expired' : enabled ? 'Calls enabled' : 'Calls are off'}</strong><span>{enabled ? 'Session-only wellness alerts' : 'You decide when to switch on'}</span><span>Two-way voice by ElevenLabs</span></div>
    </header>
    <div className="lh-alert-notice"><strong>A check-in, not an emergency service.</strong> WHOOP provides delayed, scored readings—not continuous monitoring. These alerts cannot detect a medical emergency. If you feel seriously unwell, contact local emergency services directly.</div>
    {!connected && <p className="lh-alert-hint">{mockRest ? 'Calls disabled: REST metrics are mocked. Real Bluetooth heart rate is display-only and never triggers a call. Switch the server to real WHOOP mode before enabling contact alerts.' : 'Connect WHOOP above to choose alerts and save your emergency contact.'}</p>}
    {error && <div className="lh-message lh-error" role="alert"><p>{error}</p><button type="button" className="btn sm" onClick={() => setAttempt(v => v + 1)}>Reload alert settings</button></div>}
    {expired && <p className="lh-alert-hint">Reconnect WHOOP to set up alerts again. This session is no longer monitoring.</p>}
    <form onSubmit={save}>
      <fieldset className="lh-alert-fieldset" disabled={locked}>
        <legend className="lh-alert-step"><span>01</span> Choose your signals</legend>
        <p className="small muted">Set personal thresholds with a clinician’s guidance. No medical thresholds are preselected. “At or above” and “at or below” include the value you enter.</p>
        <div className="lh-alert-grid">
          {ALERT_RULES.map(rule => {
            const selected = Object.hasOwn(draft.rules, rule.id);
            return <article key={rule.id} className={`lh-alert-tile ${selected ? 'lh-alert-selected' : ''} ${rule.unavailable ? 'lh-alert-unavailable' : ''}`}>
              <label className="lh-alert-choice" htmlFor={`alert-${rule.id}`}><Illustration icon={rule.icon} /><span className="lh-alert-choice-row"><span className="label">{rule.unavailable ? 'Not in WHOOP API' : 'WHOOP · Scored data'}</span><input id={`alert-${rule.id}`} type="checkbox" checked={selected} disabled={rule.unavailable} onChange={() => toggle(rule.id)} aria-label={rule.title} /></span><h3>{rule.title}</h3><p>{rule.description}</p></label>
              {selected && <label className="lh-alert-threshold">{rule.direction === 'above' ? 'At or above' : 'At or below'}<span><input aria-label={`${rule.title} threshold`} type="number" min={rule.min} max={rule.max} step="0.1" required value={draft.rules[rule.id]} placeholder="Set value" onChange={e => update({ rules: { ...draft.rules, [rule.id]: e.target.value } })} /><span>{rule.unit}</span></span><small>Allowed input: {rule.min}–{rule.max} {rule.unit}</small></label>}
            </article>;
          })}
        </div>
        <div className="lh-alert-contact-panel">
          <div><h3 className="lh-alert-step"><span>02</span> Your emergency contact</h3><p>Someone who knows you. Someone who can check in.</p><p className="small muted">Use a personal number with country code, not an emergency-service number. The server owner must approve this number before calling can be enabled.</p></div>
          <div className="lh-alert-contact-fields">
            <label>Your name<input autoComplete="name" maxLength="80" required={draft.enabled} value={draft.patientName} onChange={e => update({ patientName: e.target.value })} placeholder="How Rafeeq should refer to you" /></label>
            <label>Contact name<input autoComplete="off" maxLength="80" required={draft.enabled} value={draft.contact.name} onChange={e => contact('name', e.target.value)} placeholder="Full name" /></label>
            <label>Relationship <span className="muted">Optional</span><input autoComplete="off" maxLength="60" value={draft.contact.relationship} onChange={e => contact('relationship', e.target.value)} placeholder="Partner, family member, friend" /></label>
            <label>Contact phone<input type="tel" autoComplete="off" maxLength="16" pattern="\+[1-9][0-9]{7,14}" required={draft.enabled} value={draft.contact.phone} onChange={e => contact('phone', e.target.value)} placeholder="+ country code and number" /></label>
          </div>
        </div>
        <div className="lh-alert-permission">
          <h3 className="lh-alert-step"><span>03</span> Put your plan in place</h3>
          <label className="lh-alert-checkline"><input type="checkbox" checked={draft.consent} onChange={e => update({ consent: e.target.checked, enabled: e.target.checked ? draft.enabled : false })} /><span>I have this contact’s permission to receive automated AI calls. I agree to share my name and matched WHOOP readings with Twilio, ElevenLabs, and this contact, and to have the AI conversation processed by these providers.</span></label>
          <label className="lh-alert-checkline lh-alert-enable"><input type="checkbox" checked={draft.enabled} disabled={!status?.ready || !draft.consent} onChange={e => update({ enabled: e.target.checked })} /><span><strong>Let Rafeeq call my emergency contact</strong><small>Only selected signals. At most one call attempt per WHOOP account every 24 hours. No automatic redial.</small></span></label>
          {connected && status && !status.ready && <p className="small muted">Calling setup is incomplete on the server. You can save your preferences with calls off.</p>}
        </div>
      </fieldset>
      <div className="lh-alert-save"><button className="btn primary" type="submit" disabled={locked}>{busy ? 'Saving…' : 'Save alert preferences'}</button>{enabled && <button type="button" className="btn danger" disabled={busy} onClick={pause}>Pause automatic calls</button>}<span className="small muted">{dirty ? 'Unsaved changes · saved settings remain in effect' : 'No calls are placed by saving this form.'}</span></div>
      {message && <p className="lh-alert-hint" role="status">{message}</p>}
    </form>
    <div className="lh-alert-lifetime"><strong>Session-only, not always-on protection.</strong><p>Preferences and contact details are held in server memory only. Alerts stop on sign-out, disconnect, session expiry (24 hours), or server restart—even if your browser still shows this page. Closing the tab does not pause an active session. Webhooks and a five-minute server check look for new readings; old or missing readings never trigger a call. Re-saving starts a new monitoring window.</p>{status?.expiresAt && <p>Session ends: {new Date(status.expiresAt).toLocaleString()}. Last successful check: {status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : 'Not checked yet'}.</p>}{status?.issue && <p className="lh-error" role="alert">{status.issue}</p>}</div>
    {!!status?.events.length && <div className="lh-alert-history"><h3 className="label">Recent alert activity</h3><ul>{status.events.map(event => <li key={event.id}><div><strong>{eventLabels[event.status] ?? 'Status unavailable'}</strong><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></div><p>{event.readings.map(reading => `${reading.title}: ${reading.value} ${reading.unit}`).join(' · ')}</p>{event.voiceStatus && <p>{voiceLabels[event.voiceStatus] ?? 'Voice status unavailable'}</p>}</li>)}</ul></div>}
    <details className="lh-alert-setup"><summary>Connect Twilio, voice agent & WHOOP</summary><ol>
      <li>On the server, set <code>TWILIO_ACCOUNT_SID</code>, a rotated <code>TWILIO_AUTH_TOKEN</code>, and <code>TWILIO_FROM_NUMBER</code> (a voice-capable number in that Twilio account). Add consenting destinations to the comma-separated <code>TWILIO_ALLOWED_NUMBERS</code>. Trial accounts require verified destination numbers; enable the appropriate Voice geographic permissions in Twilio.</li>
      <li>Twilio handles the phone call; ElevenLabs supplies the two-way AI voice. Set <code>LIVE_HEALTH_ELEVENLABS_API_KEY</code> and <code>LIVE_HEALTH_ELEVENLABS_AGENT_ID</code> for a dedicated alert agent, not a demo agent. Enable system-prompt and first-message overrides on that agent. The server sends the prompt below with <code>patient_name</code>, <code>contact_name</code>, and <code>alert_summary</code> only after the contact presses 1. Do not attach booking, transfer, or demo-action tools.</li>
      <li>Review ElevenLabs audio/transcript retention before enabling calls. Twilio call recording is disabled by this app. Calls are capped at three minutes. The recipient must press 1 and confirm their name to the agent before health details are spoken; this is self-confirmation, not strong identity verification.</li>
      <li>Set <code>APP_ORIGIN</code> to your public HTTPS origin. The server automatically supplies <code>APP_ORIGIN/live-health/webhooks/twilio/status</code> and <code>APP_ORIGIN/live-health/webhooks/twilio/voice</code> on each call. Do not enter the site root or change query parameters. Both endpoints verify <code>X-Twilio-Signature</code> with the account Auth Token; no separate webhook key is needed.</li>
      <li>Register <code>APP_ORIGIN/live-health/webhooks/whoop</code> as a WHOOP v2 webhook. Reconnect WHOOP to grant <code>read:profile</code>, used only to match your account ID to signed events. Set <code>TWILIO_CALLS_ENABLED=true</code> only after reviewing the full setup, then redeploy your Node web service.</li>
      <li>For reliable, long-running monitoring, this app still needs persistent encrypted account storage and a durable job queue. This session-only feature is not a medical alert system.</li>
    </ol><pre>{ALERT_AGENT_PROMPT}</pre></details>
  </section>;
}
