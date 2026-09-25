# Rafeeq · رفيق

**A personal health agent connected to a provider Care OS.** Built as a Hub71 hackathon demo for an Abu Dhabi healthcare scenario, Rafeeq shows how fragmented health information could become coordinated follow-up: spot a missed finding, explain it to the patient, arrange the next step, and update the care team live.

The repository is named **CareOs**; the application is **Rafeeq**. It combines a patient-facing Arabic/English assistant with a dashboard for a provider paid a fixed amount per member per month, illustrating how proactive care could reduce avoidable admissions.

> All patient records are synthetic. Healthcare integrations, bookings, pre-authorisations and care-team notifications are simulated. Admission risks and savings are illustrative, not clinically validated predictions or measured outcomes. This is not medical advice or a production clinical system.

## What the demo includes

| Experience | Route | Purpose |
|---|---|---|
| Landing page | `/` | Scroll-based product pitch and explanation of the care model. |
| Patient agent | `/patient.html` | Review a synthetic health record, genome report and wearable signals; discuss findings by voice or text in Arabic or English; request follow-up actions. |
| Provider Care OS | `/provider.html` | Prioritise a 40-member sample panel, review pre-call briefs, simulate care-coordinator outreach, and follow actions and estimated savings live. |

### Patient agent

- Two detailed patient scenarios: **Fatima Al Mansoori** (`P-1001`) and **Rahul Menon** (`P-2002`).
- A deterministic, evidence-carrying safety-net engine flags gene–drug interactions, missed imaging follow-up, wearable rhythm alerts without a subsequent ECG, kidney and HbA1c trends, cholesterol concerns, and unbooked referrals.
- Four action tools simulate appointment booking, insurance pre-authorisation, care-team alerts and visit-preparation sheets.
- Agent prompts require consent before actions and route medication decisions to clinicians rather than changing treatment.

### Provider Care OS

- A synthetic diabetes and heart-failure panel ranked by an illustrative risk score.
- Pre-call briefs and post-conversation notes generated through optional text-LLM providers, with deterministic templates when those providers are unavailable.
- An Arabic/English outreach agent, **Noor**, with tools to schedule visits, log outcomes and escalate to a nurse.
- Contract and cost charts for an illustrative **1,240-member** contract; the interactive worklist contains **40 sample members**, not the entire contract population.
- A shared Server-Sent Events (SSE) feed connects both apps. Fatima belongs to both experiences, so her patient-agent actions appear in the provider feed and can update her worklist status and session savings.

## How it fits together

### The journey

1. **Landing (`/`)** tells the story (*the record already knew; nobody acted on it*) and links to both apps.
2. **Patient agent (`/patient.html`)**: Fatima's record is loaded, and the safety-net rules list what was missed, each with its evidence. She talks to Rafeeq by voice or text. Rafeeq explains a finding and, with her consent, acts: it books the visit, files the pre-authorisation, alerts the care team or prepares a visit sheet. Each action appears under **Done on your behalf** and marks the finding **✓ Handled**. When the session ends, an AI note is written for the care team.
3. **Care OS (`/provider.html`)**: the provider sees contract economics and a worklist ranked by admission risk. Fatima is on it, tagged *has Rafeeq*. Selecting a member produces an AI pre-call brief. **Call** starts the outreach agent Noor, played by you as the member. Noor can book a visit, log the outcome or escalate to a nurse. When the call ends, a clinical note is written, the member's status changes, and the session-savings KPI updates.

### How a conversation turns into an action

```
Browser (patient or provider page)
  1. POST /api/session ──► server returns a short-lived ElevenLabs URL + the record as agent context
  2. browser ◄──────────► ElevenLabs agent (voice or text)
  3. agent calls a client tool, e.g. book_appointment
       └─► browser POST /api/action ──► server runs the simulated action in memory
                                         ├─ replies with the sentence the agent says back ("Booked … reference APT-…")
                                         └─ broadcasts an event on /api/events (SSE)
  4. session ends ──► POST /api/note ──► AI note (Groq → OpenRouter → template), also broadcast

Every open page listens on /api/events and refreshes what changed.
```

### Where the two apps meet

Both apps share one in-memory state and one event stream. Two things happen on the server:

- Bookings, patient-agent alerts, call outcomes and nurse escalations update the member's worklist status (**Engaged by agent**, **Booked**, **Escalated**, …).
- When a member who was still open (or waiting for a callback) becomes booked or engaged, the server adds the expected avoided cost to the session savings: *90-day admission risk × assumed risk reduction × average admission cost*.

Fatima (`P-1001`) is both a patient-agent user and a Care OS member. Anything her agent does therefore appears live in the provider's **Live signals** feed, flips her row and moves the savings KPI. That's the business case: the free patient agent is the front door, and the capitated Care OS keeps the savings from admissions it helps avoid.

## Tech stack

- **Backend:** Node.js, CommonJS modules and the built-in HTTP server; no web framework or database.
- **Frontend:** React 19 + Vite 6 (JavaScript/JSX), built as three pages: `/`, `/patient.html`, `/provider.html`.
- **Conversations:** ElevenLabs Conversational AI through `@elevenlabs/client`, bundled by Vite.
- **Briefs and notes:** Groq, then OpenRouter by default, then offline templates.
- **State:** in-memory demo records and actions; SSE for live updates between open pages.

## Run locally

### Requirements

- Node.js **18.17 or newer**, as declared in `package.json`; prefer a currently supported Node.js release.
- npm.
- For voice or conversational text: an ElevenLabs account and API key permitted to manage Conversational AI agents/tools and start conversations. Usage may incur provider charges.
- Optional Groq and/or OpenRouter API keys for generated briefs and notes.

From the repository root:

```bash
npm ci
```

For a fresh checkout, copy the example environment file only if `.env` does not already exist:

```bash
test -f .env || cp .env.example .env
```

Edit `.env` to set your keys, then build the frontend and start the server:

```bash
npm start          # vite build, then node server.js
```

Open **http://localhost:3000**. After a build, `npm run serve` starts the server without rebuilding.

For frontend development with hot reload:

```bash
npm run dev        # node server.js + Vite dev server
```

Open **http://localhost:5173**. Vite proxies `/api` (including the SSE stream) to the Node server on port 3000. The server binds to `127.0.0.1` by default. Use Chrome on localhost or serve through HTTPS for microphone access.

**Startup has external side effects when an ElevenLabs key is configured:** the server creates or updates four agents (patient and outreach, each in English and Arabic) and seven client tools in that account. Their IDs are cached in `.agents.json`, and their configuration is synchronised on subsequent starts. Wait for `Voice agents ready.` in the terminal; `/api/status` reports agent readiness or a setup error.

### Explore without API keys

The pages, synthetic records, safety-net findings, dashboard and template briefs/notes work without external AI services. On macOS/Linux, this command explicitly disables all three providers even if your local `.env` contains keys:

```bash
ELEVENLABS_API_KEY= GROQ_API_KEY= OPENROUTER_API_KEY= npm start
```

A missing-ElevenLabs-key message is expected in this mode; the HTTP server still runs. **“Type instead” and “Simulate by text” are not offline chat modes**: both connect to the same ElevenLabs agents without using a microphone, so they still need a working key and network access.

## Configuration

Existing process environment variables take precedence over `.env` values.

| Variable | Default | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | Unset | Required for voice and conversational text, including agent/tool provisioning. |
| `AGENT_LLM` | `claude-haiku-4-5` | Model configured on the ElevenLabs agents. |
| `LLM_PROVIDERS` | `groq,openrouter` | Comma-separated provider order for briefs and notes; providers without keys are skipped. |
| `GROQ_API_KEY` | Unset | Enables Groq text inference. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model for briefs and notes. |
| `OPENROUTER_API_KEY` | Unset | Enables OpenRouter text inference. |
| `OPENROUTER_MODEL` | `minimax/minimax-m3` | OpenRouter model for briefs and notes. |
| `OPENROUTER_PROVIDER_ORDER` | Unset in code; `GMICloud` in `.env.example` | Optional comma-separated routing preference within OpenRouter. |
| `HOST` | `127.0.0.1` | Listening address. Keep the demo local unless you add appropriate access controls. |
| `PORT` | `3000` | HTTP port. |

`.env`, `.agents.json`, `node_modules/` and `dist/` are Git-ignored. Never commit API keys or replace the fixtures with real patient data. Keys are used server-side; the browser receives short-lived signed conversation URLs rather than the ElevenLabs API key. When enabled, external AI providers receive the record context or transcripts needed for their requests.

## Demo walkthrough

1. Open `/patient.html` and `/provider.html` side by side on the same server.
2. Select Fatima in the patient app, switch to **عربي**, press **Start voice**, and say «نعم، ابدأ بالأهم». Alternatively, use **Type instead** for a text conversation.
3. Ask about the clopidogrel gene–drug finding and agree to alert the cardiologist. Then ask for the follow-up CT booking and its pre-authorisation.
4. Watch the provider dashboard: the alert, pre-authorisation and booking appear in **Live signals**, and Fatima's row becomes **Engaged by agent**.
5. Select a high-risk member in Care OS, read the pre-call brief, and start a call in English or Arabic. Play the member in your browser; this is not a real outbound telephone call. **Simulate by text** works without a microphone.
6. Agree to a visit, end the conversation, and review the generated clinical note and updated dashboard metrics. Without text-LLM keys, the note uses a template.
7. Try Rahul's patient scenario to see the inherited-cholesterol finding.

Use **Reset demo**, then **Confirm reset?** within four seconds, to clear the shared in-memory actions and restore the original panel across connected patient/provider pages. Restarting the server also clears session state. Neither operation deletes the remote ElevenLabs resources.

## Project structure

| Path | Responsibility |
|---|---|
| `server.js` | Environment loading, HTTP API, simulated action handlers, in-memory state, SSE, briefs and notes. |
| `lib/data.js` | Synthetic patient fixtures, deterministic sample population and illustrative contract economics; most clinical dates are relative to server start. |
| `lib/findings.js` | Explainable safety-net rules and compact patient context for the conversation agents. |
| `lib/agents.js` | ElevenLabs prompts, language settings, client-tool schemas, provisioning and signed conversation URLs. |
| `lib/llm.js` | Text-provider fallback chain and JSON response parsing. |
| `vite.config.js` | Vite multi-page build (`web/` → `dist/`) and the dev proxy to the Node server. |
| `web/*.html` | Page entries for `/`, `/patient.html` and `/provider.html`. |
| `web/src/landing/` | Landing page markup and the scroll/canvas choreography. |
| `web/src/patient/` | Patient record, findings and assistant interface. |
| `web/src/provider/` | Provider worklist, outreach, metrics and live signals. |
| `web/src/shared/` | API client, ElevenLabs session wrapper, SSE/status/session hooks and shared components. |
| `web/src/styles/` | Application and landing styles. |
| `dist/` | Built frontend served by `server.js` (Git-ignored). |
| `scripts/cleanup.js` | Deletes the cached demo agents/tools from ElevenLabs and removes the local ID cache. |

### HTTP API

These endpoints are unauthenticated and intended for local demo use.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/status` | ElevenLabs agent readiness, setup error and configured agent model. |
| GET | `/api/patients` | Available patient IDs, names and preferred languages. |
| GET | `/api/patients/:id` | Patient record, findings and session actions. |
| GET | `/api/population` | Sample worklist, contract, KPIs, cost series and recent events. |
| GET | `/api/events` | Live SSE stream. |
| POST | `/api/session` | Signed conversation URL and dynamic context; accepts `role`, `lang` and `id`. |
| POST | `/api/action` | Execute a simulated client tool; accepts `tool`, `id` and `params`. |
| POST | `/api/brief` | Pre-call brief for a member `id`. |
| POST | `/api/note` | Conversation note from `role`, `id` and `transcript`. |
| POST | `/api/reset` | Reset shared in-memory demo state and notify connected pages. |

Conversation roles are `companion` and `outreach`; languages are `en` and `ar`.

## Verification and troubleshooting

There is currently no automated test suite or linter. Build the frontend and check the server-side JavaScript syntax from the repository root:

```bash
npm run build
for file in server.js lib/*.js scripts/*.js; do
  node --check "$file" || exit 1
done
```

With the server running, smoke-check the API and open both app pages:

```bash
curl --fail http://localhost:3000/api/status
curl --fail http://localhost:3000/api/patients
curl --fail http://localhost:3000/api/population
```

- **Agent setup fails or stays unavailable:** inspect `/api/status` and the terminal output; check the ElevenLabs key, account permissions and configured model, then restart.
- **Microphone is blocked:** allow microphone access on localhost/HTTPS, or use conversational text with a working ElevenLabs setup.
- **Briefs or notes show `offline`:** no configured text provider succeeded, so the app returned a template. Check provider keys, models and terminal errors if generated output is needed.
- **Port already in use:** start with another port, for example `PORT=3001 npm start`. For `npm run dev`, the Vite proxy reads the same `PORT`.
- **Pages return 404 on port 3000:** the frontend has not been built; run `npm run build` or `npm start`.
- **Actions disappear after a restart:** expected; there is no persistent database.

### Remote-resource cleanup

Only when you intentionally want to delete this demo's remote ElevenLabs agents and tools, run:

```bash
npm run cleanup
```

**This is destructive:** the script uses IDs in `.agents.json` to delete resources in the configured ElevenLabs account, then removes the local cache. Check the account and cached resources first. Keep the cache until you no longer need those IDs for cleanup; a later keyed server start can provision new resources.

## Scope and limitations

- There are no live Malaffi, genome-programme, wearable, payer or clinic integrations. Labels and records illustrate those data sources.
- Bookings, insurance submissions, alerts and nurse escalations only change local demo state; they do not contact real healthcare services.
- The risk scores, cost trends and assumed avoided-admission savings are synthetic demonstration logic, not validated clinical or financial models.
- There is no authentication, authorisation, durable storage or production audit trail. Do not expose the server publicly or use real patient information without implementing and reviewing the necessary security, privacy and clinical safeguards.
