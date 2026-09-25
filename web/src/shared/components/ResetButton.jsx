import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Two-step reset: first click arms it, a second click within 4s resets the demo data.
export default function ResetButton() {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    try { await api.post('/api/reset', {}); } catch (e) { alert(`Reset failed: ${e.message}`); }
    setBusy(false);
    setArmed(false);
  }

  return (
    <button className={`reset-btn${armed ? ' armed' : ''}`} title="Restore the original synthetic data" disabled={busy} onClick={onClick}>
      {busy ? 'Resetting…' : armed ? 'Confirm reset?' : 'Reset demo'}
    </button>
  );
}
