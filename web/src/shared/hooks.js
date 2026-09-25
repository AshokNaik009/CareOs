import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { startAgent } from './agent.js';

// Keeps a ref pointing at the latest value, so long-lived callbacks (SSE, voice SDK) never go stale.
export function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

// Live server event stream (/api/events). One EventSource per mounted page.
export function useServerEvents(handler) {
  const h = useLatest(handler);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch (err) { console.error(err); return; }
      Promise.resolve(h.current(ev)).catch((err) => console.error(err));
    };
    return () => es.close();
  }, [h]);
}

// Banner text while the voice agents are unavailable; null once they are ready.
export function useAgentStatus() {
  const [banner, setBanner] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer;
    async function check() {
      try {
        const s = await api.get('/api/status');
        if (!alive) return;
        if (s.ready) { setBanner(null); return; }
        setBanner(s.error ? `Voice agents unavailable: ${s.error}` : 'Setting up voice agents…');
        if (!s.error) timer = setTimeout(check, 1500);
      } catch {
        if (alive) setBanner('Server unreachable.');
      }
    }
    check();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return banner;
}

let msgId = 0;

// One agent conversation at a time. The session lives in a ref (the SDK callbacks outlive renders);
// React state only mirrors what the UI shows.
// handlers: { onMode(mode, opts), onStatus(status, opts), onTool(name, params, result, opts), onEnd(transcript, opts) }
export function useAgentSession(handlers) {
  const h = useLatest(handlers);
  const sessionRef = useRef(null);
  const startingRef = useRef(false);
  const silentRef = useRef(false);
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(null); // null, or { textOnly } while a session is live
  const [orb, setOrb] = useState('idle');

  const addMsg = useCallback((cls, text) => setMessages((m) => [...m, { id: ++msgId, cls, text }]), []);
  const clear = useCallback(() => setMessages([]), []);

  const start = useCallback(async (opts) => {
    startingRef.current = true;
    let endedEarly = false;
    try {
      const s = await startAgent(opts, {
        onMessage: (role, text) => addMsg(role, text),
        onMode: (mode) => {
          if (opts.textOnly) return;
          setOrb(mode);
          h.current.onMode && h.current.onMode(mode, opts);
        },
        onStatus: (status) => h.current.onStatus && h.current.onStatus(status, opts),
        onTool: (name, params, result) => h.current.onTool && h.current.onTool(name, params, result, opts),
        onError: (m) => addMsg('err', m),
        onEnd: (transcript) => {
          endedEarly = true;
          sessionRef.current = null;
          setRunning(null);
          setOrb('idle');
          if (!silentRef.current && h.current.onEnd) h.current.onEnd(transcript, opts);
        },
      });
      if (!endedEarly) {
        sessionRef.current = s;
        setRunning({ textOnly: s.textOnly });
        if (s.textOnly) setOrb('listening');
      }
      return s;
    } finally {
      startingRef.current = false;
    }
  }, [addMsg, h]);

  const sendText = useCallback((text) => { if (sessionRef.current) sessionRef.current.sendText(text); }, []);
  const end = useCallback(async () => { if (sessionRef.current) await sessionRef.current.end(); }, []);
  // Ends without firing onEnd (used by demo reset: no note is written).
  const endSilently = useCallback(async () => {
    if (!sessionRef.current) return;
    silentRef.current = true;
    try { await sessionRef.current.end(); } catch { /* already closed */ } finally { silentRef.current = false; }
  }, []);

  // Hang up if the page unmounts mid-call.
  useEffect(() => () => { if (sessionRef.current) sessionRef.current.end().catch(() => {}); }, []);

  return {
    messages, running, orb, addMsg, clear, start, sendText, end, endSilently,
    busy: () => !!(sessionRef.current || startingRef.current),
    session: () => sessionRef.current,
  };
}
