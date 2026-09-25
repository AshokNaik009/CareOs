import { useEffect, useRef, useState } from 'react';
import { createHeartRateConnection } from './heart-rate.mjs';

const labels = {
  checking: 'Checking support', unavailable: 'Browser unavailable', idle: 'Not paired',
  requesting: 'Choose a device', connecting: 'Connecting', waiting: 'Waiting for a reading',
  live: 'Live Bluetooth', stale: 'Reading stale', no_contact: 'Check sensor fit',
  no_signal: 'No usable signal', invalid: 'Unreadable signal', disconnected: 'Disconnected', error: 'Connection failed',
};

export default function LiveHeartRate() {
  const connection = useRef(null);
  const [view, setView] = useState({ status: 'checking', connected: false, bpm: null, receivedAt: null, deviceName: null, message: '' });
  useEffect(() => {
    const controller = createHeartRateConnection({ bluetooth: navigator.bluetooth, secureContext: window.isSecureContext, onChange: setView });
    connection.current = controller;
    setView(controller.getState());
    const checkFreshness = () => { if (document.visibilityState === 'visible') controller.checkFreshness(); };
    const disconnect = () => controller.disconnect();
    document.addEventListener('visibilitychange', checkFreshness);
    window.addEventListener('pagehide', disconnect);
    return () => {
      document.removeEventListener('visibilitychange', checkFreshness);
      window.removeEventListener('pagehide', disconnect);
      controller.dispose();
      connection.current = null;
    };
  }, []);

  const pairing = ['requesting', 'connecting'].includes(view.status);
  const unsupported = ['checking', 'unavailable'].includes(view.status);
  return <section className={`card lh-bluetooth lh-bluetooth-${view.status}`} id="live-heart-rate" aria-labelledby="live-heart-rate-title">
    <h2><span id="live-heart-rate-title">Live heart rate</span> <span className="source" aria-live="polite">{labels[view.status]}</span></h2>
    <div className="lh-bluetooth-body">
      <div className="lh-live-reading" role="group" aria-label="Current live heart rate">
        <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12h5l3-8 4 16 3-8h5" /></svg>
        <strong data-testid="live-bpm">{view.bpm ?? '—'}</strong><span className="label">Beats per minute</span>
      </div>
      <div>
        <p className="lh-sensor">{view.deviceName ? `Selected sensor: ${view.deviceName}` : 'Direct from your nearby sensor, not the WHOOP cloud'}</p>
        <p role={view.status === 'error' ? 'alert' : undefined}>{view.message}</p>
        <p className="small muted">{view.receivedAt == null ? 'No live reading received yet.' : `Last valid reading received at ${new Date(view.receivedAt).toLocaleTimeString()}.`}</p>
        <div className="lh-actions">
          {pairing || view.connected
            ? <button className="btn" onClick={() => connection.current?.disconnect()}>{pairing ? 'Cancel pairing' : 'Disconnect Bluetooth'}</button>
            : <button className="btn primary" disabled={unsupported} onClick={() => connection.current?.connect()}>Connect live heart rate</button>}
          <span className="label">On this browser only · Not saved or uploaded</span>
        </div>
      </div>
    </div>
    <details className="lh-help">
      <summary>How to connect your WHOOP</summary>
      <ol>
        <li>Wear your WHOOP and open the WHOOP app on your phone. In <strong>Device Settings</strong>, turn on <strong>Heart Rate Broadcast</strong> (also called <strong>HR Broadcast</strong>).</li>
        <li>Turn on Bluetooth on your Mac. Open this app directly in <strong>Chrome or Edge</strong>, using HTTPS or localhost. If prompted, allow Bluetooth in the browser and in macOS <strong>Privacy & Security → Bluetooth</strong>.</li>
        <li>Click <strong>Connect live heart rate</strong>, select your WHOOP in the device picker and keep it nearby. The picker may also list other heart-rate monitors; choose your own sensor.</li>
      </ol>
      <p>If WHOOP is missing or connects without readings, toggle Heart Rate Broadcast and disconnect other fitness apps or equipment receiving its broadcast, then try again. You do not need to remove your WHOOP phone pairing.</p>
      <p>Keep this page open. A sleeping Mac, background tab or out-of-range sensor can interrupt readings. Values disappear after 10 seconds without a new packet; reconnect manually after a lost connection. To stop broadcasting entirely, turn Heart Rate Broadcast off in the WHOOP app.</p>
    </details>
    <p className="small muted"><strong>Real sensor only. Never mocked.</strong> No REST response, sample metric or saved value is used for live BPM. Live heart rate is not resting heart rate or HRV. It does not change your daily analysis, recovery status or health flags. This is not a medical monitor.</p>
  </section>;
}
