# Rafeeq · رفيق

Hub71 demo combining both ideas:

1. **Patient agent** (`/patient.html`): a personal health agent that holds a resident's Malaffi record, genome report and wearable data. It talks by voice in Arabic or English, runs a missed-findings safety net over the record, and acts on the patient's behalf. It books visits, files insurance pre-authorisations, alerts the care team and prepares visit sheets.
2. **Care OS** (`/provider.html`): a risk-bearing provider paid a fixed amount per member per month. It ranks the diabetes and heart-failure panel by admission risk, writes AI pre-call briefs, and runs AI voice outreach that closes care gaps. Savings update live.
3. **Landing** (`/`): the pitch as a scroll story.

The two apps share one event stream. Anything Fatima's patient agent does shows up live in the Care OS feed.

## Run

```bash
npm install
cp .env.example .env   # then fill in the keys (already done locally)
npm start              # http://localhost:3000
```

On start the server creates or updates 4 ElevenLabs agents (health agent and outreach, each in EN and AR) and 7 client tools. It caches their ids in `.agents.json`. Run `npm run cleanup` to delete them from your ElevenLabs account.

Use Chrome on `localhost` for voice, since the browser only allows microphone access there or on https. "Type instead" / "Simulate by text" runs the same agents without a mic. Use it in noisy rooms.

## Demo script

1. Open `/patient.html` and `/provider.html` side by side.
2. Patient: switch to **عربي**, press **Start voice**, say «نعم، ابدأ بالأهم». Rafeeq explains the clopidogrel gene–drug clash and offers to alert the cardiologist. Say yes, then ask it to book the CT and file the pre-auth.
3. Watch the Care OS: the alert, pre-auth and booking land in *Live signals*, and Fatima's row flips to *Engaged by agent*.
4. Care OS: pick a high-risk member, read the AI pre-call brief, press **Call**, and play the member. When you hang up, an AI clinical note is written.

## Architecture

| Piece | What |
|---|---|
| `server.js` | Plain Node HTTP server, in-memory state, SSE event stream. Keys never leave the server; the browser only gets short-lived signed conversation URLs. |
| `lib/findings.js` | Deterministic, evidence-carrying safety-net rules: unactioned radiology recommendations, CPIC gene–drug pairs, wearable rhythm alerts without an ECG, kidney decline without protective medicine, HbA1c trends, and referrals never booked. |
| `lib/agents.js` | ElevenLabs Conversational AI provisioning: prompts, voices and client tools. The agent LLM is `claude-haiku-4-5` (override with `AGENT_LLM`). |
| `lib/llm.js` | Text AI for pre-call briefs and call notes: Groq (`openai/gpt-oss-120b`) first, then OpenRouter (`minimax/minimax-m3`), then an offline template. |
| `lib/data.js` | Synthetic patients, the 40-member panel and illustrative contract economics. Dates are relative to server start. |

All data is synthetic. Bookings and pre-auths are simulated. This is not medical advice.
