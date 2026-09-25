// ElevenLabs voice/text session wrapper. The server hands out a short-lived signed URL; every
// client tool the agent calls is executed server-side via /api/action.
import { Conversation } from '@elevenlabs/client';
import { api } from './api.js';

const TOOL_NAMES = ['propose_visit', 'book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary', 'schedule_visit', 'log_call_outcome', 'escalate_to_nurse'];

// h: { onMessage(role, text), onMode(mode), onStatus(status), onTool(name, params, result), onEnd(transcript), onError(msg) }
export async function startAgent({ role, lang, id, textOnly }, h) {
  const session = await api.post('/api/session', { role, lang, id });
  const transcript = [];
  let ended = false;

  const clientTools = {};
  for (const name of TOOL_NAMES) {
    clientTools[name] = async (params) => {
      const r = await api.post('/api/action', { tool: name, id, params, sessionId: session.sessionId, transcript });
      h.onTool && h.onTool(name, params, r);
      return r.say;
    };
  }

  const finish = () => {
    if (ended) return;
    ended = true;
    h.onEnd && h.onEnd(transcript);
  };

  const conv = await Conversation.startSession({
    signedUrl: session.signedUrl,
    dynamicVariables: session.dynamicVariables,
    textOnly: !!textOnly,
    clientTools,
    onMessage: ({ source, message }) => {
      const r = source === 'user' ? 'user' : 'agent';
      transcript.push({ role: r, message });
      h.onMessage && h.onMessage(r, message);
    },
    onModeChange: ({ mode }) => h.onMode && h.onMode(mode),
    onStatusChange: ({ status }) => h.onStatus && h.onStatus(status),
    onError: (msg) => h.onError && h.onError(typeof msg === 'string' ? msg : (msg && msg.message) || 'Voice error'),
    onDisconnect: finish,
  });

  return {
    textOnly: !!textOnly,
    transcript,
    get ended() { return ended; },
    sendText(text) {
      transcript.push({ role: 'user', message: text });
      h.onMessage && h.onMessage('user', text);
      conv.sendUserMessage(text);
    },
    async end() { try { await conv.endSession(); } finally { finish(); } },
  };
}
