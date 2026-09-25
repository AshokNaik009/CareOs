import { useEffect, useState } from 'react';
import TopBar from '../shared/components/TopBar.jsx';
import LiveHeartRate from './LiveHeartRate.jsx';
import Methodology from './Methodology.jsx';
import EmergencyAlerts from './EmergencyAlerts.jsx';
import { Baselines, HistoryChart, MetricCards, SleepAndWorkouts, fmt } from './Report.jsx';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const initialProfile = { age: '', sex: 'unspecified', goal: 'balanced' };

async function api(path, options = {}) {
  const response = await fetch(`/live-health${path}`, { credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('The server did not return a valid response. Please try again.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'Could not complete the request.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export default function LiveHealthApp() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(initialProfile);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [copyState, setCopyState] = useState('Copy JSON');
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const messages = { denied: 'WHOOP connection was cancelled. You can try again whenever you’re ready.', invalid_state: 'Your connection request expired or could not be verified. Please start again.', failed: 'WHOOP authorization failed. Check your app credentials and registered callback, then reconnect.', not_configured: 'Add your WHOOP developer credentials on the server to enable connection.', invalid_scope: 'WHOOP rejected the requested permissions. Enable every scope this app requests, including read:profile, for your WHOOP developer app, then reconnect.' };
    const status = new URLSearchParams(location.search).get('connection');
    if (messages[status]) setError(messages[status]);
    if (status) history.replaceState(null, '', location.pathname);
    const controller = new AbortController();
    api('/api/session', { signal: controller.signal }).then(setSession).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!session?.connected) { setBusy(false); setReport(null); return; }
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setReport(null);
    setCopyState('Copy JSON');
    api('/api/report', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone, profile: { ...profile, age: profile.age === '' ? null : Number(profile.age) } }) })
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(e => { if (!controller.signal.aborted && e.name !== 'AbortError') { setError(e.message); if (e.status === 401) setSession(s => ({ ...s, connected: false })); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [session?.connected, profile, attempt]);

  async function disconnect() {
    if (session?.sample) return logout();
    if (!window.confirm('Disconnect WHOOP and revoke this app’s access? This also clears your session and cached data.')) return;
    setDisconnecting(true);
    try { await api('/api/disconnect', { method: 'POST' }); setSession(s => ({ ...s, connected: false })); setReport(null); setProfile(initialProfile); setError(''); }
    catch (e) { setError(e.message); }
    finally { setDisconnecting(false); }
  }

  async function logout() {
    try { await api('/api/logout', { method: 'POST' }); setSession(s => ({ ...s, connected: false, sample: false })); setReport(null); setProfile(initialProfile); setError(''); }
    catch (e) { setError(e.message); }
  }

  async function copyJson() {
    try { await navigator.clipboard.writeText(JSON.stringify(report.analysis, null, 2)); setCopyState('Copied'); }
    catch { setCopyState('Select and copy the JSON below'); }
  }

  const currentDate = report?.date ?? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const status = report?.analysis.recovery_status;
  return <>
    <TopBar active="live-health" brand={<>Rafeeq <span className="ar">رفيق</span> <small>Live health</small></>}>
      <span className="demo-note">{session?.sample ? 'Sample data' : session?.connected ? 'WHOOP connected' : session ? 'Not connected' : 'Checking connection'}</span>
    </TopBar>
    <main className="page lh-page" id="overview">
      <header className="lh-heading">
        <div>
          <p className="label">{new Date(`${currentDate}T12:00:00`).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · Health & performance</p>
          <h1 className="display">Your day, <br /><span>in perspective.</span></h1>
          <p className="muted">Your body’s signals. Your personal baseline. A little more clarity.</p>
        </div>
        {session?.connected && <button className="btn primary" disabled={busy} onClick={() => setAttempt(v => v + 1)}>{busy ? 'Syncing…' : session.sample ? 'Refresh sample' : 'Sync WHOOP'}</button>}
      </header>
      <nav className="lh-section-nav" aria-label="Health sections">
        <a href="#overview">Overview</a><a href="#live-heart-rate">Live heart rate</a><a href="#baseline">Your baseline</a><a href="#method">How it works</a><a href="#emergency-alerts">Your circle of care</a>
        <span>{session?.sample ? 'Sample data · Not your readings' : 'Personal data · Not a demo'}</span>
      </nav>
      {session?.sample && <div className="lh-message lh-sample" role="status"><p><strong>Sample data — not your readings.</strong> Generated for demonstration only. Contact alerts and calls are turned off in sample mode.</p><button className="btn sm" onClick={logout}>Exit sample mode</button></div>}
      {error && <div className="lh-message lh-error" role="alert"><p>{error}</p><button className="btn sm" onClick={() => { setError(''); setAttempt(v => v + 1); }}>Try again</button></div>}
      {busy && <div className="lh-message" role="status">Reading your history and calculating personal baselines…</div>}
      {report ? <section className={`card lh-brief lh-status-${status ?? 'unknown'}`}>
        <div>
          <p className="label">Your daily brief</p>
          <h2 className="lh-display-title">{report.analysis.health_flag ? 'A little extra care today.' : status === null ? 'Waiting for today’s picture.' : report.analysis.trends.hrv === 'down' || report.analysis.trends.sleep === 'declining' || report.analysis.trends.resting_hr === 'up' ? 'Make room for recovery.' : 'Let your own baseline guide you.'}</h2>
          <p>{report.analysis.summary}</p>
          <p className="label">{report.sample ? 'Sample data · ' : ''}Local rules · Synced {new Date(report.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {timeZone}</p>
        </div>
        <div className="lh-recovery">
          <strong>{fmt(report.current?.recovery)}{report.current?.recovery != null && <small>%</small>}</strong>
          <span className="label">{status ? `${status} recovery` : 'Not scored'}</span>
          <svg viewBox="0 0 100 4" aria-hidden="true"><rect width="100" height="4" className="lh-recovery-track" /><rect width={report.current?.recovery ?? 0} height="4" className="lh-recovery-fill" /></svg>
        </div>
      </section> : <section className="card lh-welcome">
        <div>
          <p className="label">Personal by design</p>
          <h2 className="lh-display-title">Less guesswork.<br />More understanding.</h2>
          <p>Turn your WHOOP recovery, sleep and strain into a clear daily brief. Built on your history, never on someone else’s numbers.</p>
          <p className="label">Private, server-side analysis · No AI API key needed</p>
        </div>
        <div className="lh-connect">
          <h3>{session?.connected ? 'Your brief is on its way' : 'Start with your own data'}</h3>
          <p>{session?.connected ? 'Sync your wearable to bring your latest readings into view.' : 'Connect your WHOOP account to see what your recent patterns mean for today.'}</p>
          {!session?.connected && (session?.configured
            ? <a className="btn primary" href="/live-health/auth/whoop">Connect WHOOP</a>
            : <button className="btn primary" disabled>{session ? 'Server setup needed' : 'Checking connection…'}</button>)}
          {!session?.connected && session?.sampleAvailable && <a className="btn" href="/live-health/auth/sample">View sample data</a>}
          <p className="small muted">Read-only health access. Disconnect whenever you choose.</p>
        </div>
      </section>}
      {session && !session.configured && <section className="card lh-setup"><details open>
        <summary>Connect your WHOOP developer app</summary>
        <ol>
          <li>Create an app in the <a href="https://developer-dashboard.whoop.com/" target="_blank" rel="noreferrer">WHOOP Developer Dashboard</a>.</li>
          <li>Set <code>WHOOP_CLIENT_ID</code>, <code>WHOOP_CLIENT_SECRET</code> and <code>APP_ORIGIN</code> in CareOs’s server environment or local <code>.env</code>. Keep secrets out of React.</li>
          <li>Register <code>APP_ORIGIN/live-health/auth/whoop/callback</code> as the redirect URL. Use an HTTPS origin or tunnel if WHOOP does not accept your localhost callback.</li>
          <li>For <code>npm start</code>, use <code>APP_ORIGIN=http://localhost:3000</code>. For <code>npm run dev</code>, set <code>APP_ORIGIN=http://localhost:5173</code> in the shell before starting. It must match the browser origin exactly.</li>
          <li>Production requires an HTTPS origin behind a TLS proxy and <code>NODE_ENV=production</code>. The existing patient/provider demos still require separate access controls before public deployment.</li>
        </ol>
      </details></section>}
      <LiveHeartRate key={session?.connected ? 'signed-in' : 'signed-out'} />
      <MetricCards report={report} />
      {report?.analysis.health_flag && <section className="card lh-health-flag" role="alert"><h2>A pattern worth checking</h2><p>{report.analysis.health_flag}</p></section>}
      {report && <>
        <div className="lh-columns">
          <section className="card"><h2>Your next best moves <span className="source">Small steps, today</span></h2><ol className="lh-recommendations">{report.analysis.recommendations.map((item, i) => <li key={item}><span>{String(i + 1).padStart(2, '0')}</span><p>{item}</p></li>)}</ol></section>
          <section className="card"><h2>Reading between the numbers <span className="source">What stands out</span></h2><ul className="lh-insights">{report.analysis.key_insights.map(item => <li key={item}>{item}</li>)}</ul></section>
        </div>
        <HistoryChart report={report} />
        <SleepAndWorkouts report={report} />
        <Baselines report={report} />
      </>}
      {!report && <section className="card lh-empty" id="baseline"><h2>Your history tells the story.</h2><p>Compare today with your own 7-day and 30-day averages. Missing readings stay missing, and trends only appear when there’s enough history.</p><span className="tag">{session?.sampleAvailable ? 'Sample data is opt-in and labelled' : 'No sample readings'}</span></section>}
      <section className="card lh-profile">
        <div><h2>What are you working toward?</h2><p className="muted">Your goal shapes the guidance, not the measurements.</p></div>
        <div className="lh-profile-fields">
          <label>Current goal<select value={profile.goal} onChange={e => setProfile(p => ({ ...p, goal: e.target.value }))}><option value="balanced">Everyday balance</option><option value="performance">Training performance</option><option value="recovery">Better recovery</option></select></label>
          <details><summary>Optional profile</summary><div className="lh-optional-fields">
            <label>Age<input type="number" min="1" max="120" value={profile.age} placeholder="Not provided" onChange={e => setProfile(p => ({ ...p, age: e.target.value }))} /></label>
            <label>Sex<select value={profile.sex} onChange={e => setProfile(p => ({ ...p, sex: e.target.value }))}><option value="unspecified">Not provided</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          </div><p className="small muted">Optional, not saved. No age- or sex-based norms are applied.</p></details>
        </div>
      </section>
      <Methodology />
      <EmergencyAlerts key={session?.connected && !session.sample ? 'alerts-connected' : 'alerts-disconnected'} connected={Boolean(session?.connected && !session.sample)} api={api} />
      {report && <section className="card lh-json"><details><summary>View structured analysis JSON</summary><div className="lh-actions"><span className="label">Exact analysis schema · Unknown values are null</span><button className="btn sm" onClick={copyJson}>{copyState}</button></div><pre>{JSON.stringify(report.analysis, null, 2)}</pre></details></section>}
      <footer className="lh-footer">
        <span className="label">Rafeeq Live Health · Independent wellness companion. Not affiliated with WHOOP.</span>
        {session?.connected && (session.sample
          ? <div className="lh-actions"><button className="btn sm" onClick={logout}>Exit sample mode</button></div>
          : <div className="lh-actions"><button className="btn sm" onClick={logout}>Sign out</button><button className="btn sm danger" disabled={disconnecting} onClick={disconnect}>{disconnecting ? 'Disconnecting…' : 'Disconnect WHOOP'}</button></div>)}
        <p>Not medical advice. Listen to your body, not just your wearable. Your readings are not shared with the demo’s AI agents or provider feed. If you enable contact alerts, matched readings and the AI conversation are processed by Twilio and ElevenLabs and shared with your chosen contact. <a href="/privacy">Privacy policy</a>.</p>
      </footer>
    </main>
  </>;
}
