// Landing: the pitch as a scroll story. Markup only; all motion lives in choreography.js.
import { useEffect, useRef } from 'react';
import Split from './Split.jsx';
import { mountChoreography } from './choreography.js';

const d = (ms) => ({ '--d': `${ms}ms` });

const RAIL = [
  { plate: 'helix', label: 'Genome × medication', title: 'Clopidogrel may not work', meta: 'CYP2C19 *2/*2 · poor metaboliser · stent protection at risk', mark: '■ High · 300 days unreviewed' },
  { plate: 'lung', label: 'Missed follow-up', title: 'Lung nodule, no follow-up CT', meta: '7 mm nodule · Fleischner 6–12 months · never ordered', mark: '■ High · 8 months' },
  { plate: 'pulse', label: 'Wearable signal', title: '3 irregular-rhythm alerts', meta: '30 days · resting HR 72 → 81 · no ECG since', mark: '■ High · possible AF' },
  { plate: 'drops', label: 'Lab trend', title: 'Kidneys under strain', meta: 'eGFR 84 → 63 · UACR 48 · no protective medicine', mark: '□ Medium' },
  { plate: 'bars', label: 'Lab trend', title: 'HbA1c climbing to 8.9%', meta: '7.1 → 7.6 → 8.1 → 8.9 · no specialist in 14 months', mark: '□ Medium' },
  { plate: 'eye', label: 'Referral lost', title: 'Eye screening never booked', meta: 'Referral written 5 months ago · status: not scheduled', mark: '□ Medium' },
];

const CUES = ['Found in the record', 'Explained in her language', 'Insurance pre-auth filed', 'Scan booked, visit sheet ready'];

const CHAPTERS = [
  { title: 'Win the patient', text: "A free agent that holds the whole record and acts on it. We partner with DoH's Sahatna app to reach people." },
  { title: 'Take the risk', text: 'Sign with Daman and Thiqa for diabetes and heart-failure members and get paid a fixed fee per member each month.' },
  { title: 'Keep the savings', text: 'AI outreach closes care gaps before they become admissions. Every admission we prevent adds to our margin.' },
];

const ECONOMICS = [
  ['Members under contract', 'Type 2 diabetes + heart failure cohort', '1,240'],
  ['Capitation', 'Paid to us per member, per month', 'AED 1,150'],
  ['Medical cost before', 'Per member per month, pre-program', 'AED 1,080'],
  ['Medical cost after', 'Trailing 3 months with AI care OS', 'AED 955'],
  ['Annualised savings', 'Kept by the provider under the contract', 'AED 1.86M'],
];

const FAQ = [
  ['Is any of this real patient data?', 'No. Every patient, member and number is synthetic. The voice agents, speech recognition, tool calls, safety-net rules and AI notes are all live.'],
  ['Does Rafeeq diagnose or change medicines?', "No. It explains results, spots what was missed and routes clinical decisions to the patient's doctor. For emergencies it tells people to call 998."],
  ['How are missed findings detected?', 'With deterministic, explainable rules over the record: radiology recommendations never actioned, gene–drug pairs from CPIC guidance, lab trends without follow-up, wearable alerts with no ECG since, and referrals never booked. Each finding shows its evidence.'],
  ['What runs the AI?', 'Voice uses ElevenLabs Conversational AI in Arabic and English, with client tools for booking, pre-auth and alerts. Call notes and pre-call briefs use Groq first, OpenRouter as fallback, and an offline template if both fail.'],
  ['Why partner with Sahatna rather than compete?', 'Distribution is the hard part. The DoH app already reaches residents, and Rafeeq becomes the agent layer inside it.'],
];

export default function Landing() {
  const root = useRef(null);
  useEffect(() => mountChoreography(root.current), []);

  return (
    <div ref={root}>
      <header className="topbar lp-bar">
        <a className="brand" href="/" data-rev style={d(0)}>Rafeeq <span className="ar">رفيق</span></a>
        <nav className="nav">
          <a href="/patient.html" data-rev style={d(60)}>Patient agent</a>
          <a href="/provider.html" data-rev style={d(120)}>Care OS</a>
        </nav>
        <div className="spacer"></div>
        <span className="demo-note" data-rev style={d(180)}>Hub71 demo · synthetic data</span>
      </header>

      {/* 1 · Poster hero */}
      <section className="stage stage-hero" id="hero" style={{ height: '280svh' }}>
        <div className="pin dark">
          <canvas className="field" data-canvas="field" aria-hidden="true"></canvas>
          <div className="lockup">
            <div className="poster-line small-line" style={{ '--chars': 26 }}>Your health, acted upon.</div>
            <div className="poster-line big-line" style={{ '--chars': 6 }}>Rafeeq</div>
            <div className="hero-sub label" data-rev style={d(300)}>A personal health agent for every Abu Dhabi resident</div>
          </div>
          <div className="hero-meta">
            {['Malaffi record', 'Genome report', 'Wearable data', 'Arabic · English', 'Scroll ↓'].map((t, i) => <span key={t} data-rev style={d(i * 70)}>{t}</span>)}
          </div>
        </div>
      </section>

      {/* 2 · Manifesto wipe */}
      <section className="stage stage-manifesto" id="manifesto" style={{ height: '260svh' }}>
        <div className="pin">
          <div className="label manifesto-kicker" data-rev>01 · The problem</div>
          <div className="manifesto">
            <p className="m-line m-base">The record already knew. Nobody acted on it.</p>
            <p className="m-line m-fill" aria-hidden="true">The record already knew. Nobody acted on it.</p>
          </div>
          <Split as="p" className="manifesto-foot">Results get filed. Radiologists recommend follow-ups. Genome reports flag drug risks. Watches log irregular heartbeats. Each sits in a different system, and the patient falls through the gap between them.</Split>
        </div>
      </section>

      {/* 3 · Rail of findings */}
      <section className="stage stage-rail" id="rail" style={{ height: '340svh' }}>
        <div className="pin">
          <div className="rail-head">
            <Split as="h2" className="display rail-title">The record flagged it. Nobody booked it.</Split>
            <span className="label rail-hint" data-rev style={d(200)}>Scroll → the safety net, one finding at a time</span>
          </div>
          <div className="rail-track" data-rail-track>
            {RAIL.map((c, i) => (
              <article className="rcard" key={c.plate} data-rev style={d(i * 80)}>
                <canvas data-plate={c.plate}></canvas>
                <div className="rc-body"><div className="label">{c.label}</div><h3>{c.title}</h3><div className="rc-meta">{c.meta}</div><div className="rc-mark">{c.mark}</div></div>
              </article>
            ))}
          </div>
          <div className="rail-meter"><i></i></div>
        </div>
      </section>

      {/* 4 · The printed artifact */}
      <section className="stage stage-packet" id="packet" style={{ height: '420svh' }}>
        <div className="pin dark packet-grid">
          <div className="packet-copy">
            <div className="label light" data-rev>02 · It doesn't remind you. It acts.</div>
            <Split as="h2" className="display packet-title">One sentence in Arabic. Four things done.</Split>
            <Split as="p" className="packet-lede">Fatima says «احجزيها لي». Rafeeq explains the nodule, files the Thiqa pre-authorisation, books the scan and preps her questions.</Split>
            <ol className="cues" data-cues>
              {CUES.map((t, i) => <li key={t} data-rev style={d(i * 80)}><span>{String(i + 1).padStart(2, '0')}</span>{t}</li>)}
            </ol>
            <div className="status-line label light" data-status-line>● Reading Malaffi record…</div>
          </div>
          <div className="packet-wrap">
            <div className="packet">
              <div className="pk-head">
                <div className="label">Pre-authorisation · Thiqa</div>
                <div className="pk-name">CT Chest</div>
                <div className="label">Fatima Al Mansoori · Thiqa member</div>
              </div>
              <canvas className="pk-plate" data-plate="scan"></canvas>
              <div className="pk-rows">
                <div className="pk-row"><span>Reference</span><b data-pk="ref">PA-·····</b></div>
                <div className="pk-row"><span>Status</span><b data-pk="status">pending</b></div>
                <div className="pk-row"><span>Booked</span><b data-pk="date">— · —</b></div>
              </div>
              <div className="perf" aria-hidden="true"></div>
            </div>
            <div className="pk-meter"><i></i></div>
          </div>
        </div>
      </section>

      {/* 5 · Season band: the business */}
      <section className="stage stage-season" id="season" style={{ height: '300svh' }}>
        <div className="pin">
          <canvas className="contours" data-canvas="contours" aria-hidden="true"></canvas>
          <div className="season-content">
            <div className="label" data-rev>03 · Then we become the provider</div>
            <Split as="h2" className="display season-title">The patient agent is the front door. The care OS is the business.</Split>
            <div className="chapters" data-chapters>
              {CHAPTERS.map((c, i) => (
                <div className="chapter" key={c.title} data-rev style={d(i * 90)}><div className="label">Chapter {String(i + 1).padStart(2, '0')}</div><h3>{c.title}</h3><p>{c.text}</p></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Economics table */}
      <section className="band">
        <div className="band-inner">
          <div className="label" data-rev>04 · Illustrative contract economics</div>
          <Split as="h2" className="display band-title">Where the money is.</Split>
          <table className="price-table">
            <tbody>
              {ECONOMICS.map(([label, text, value], i) => (
                <tr key={label} data-rev style={d(i * 70)}><td className="label">{label}</td><td>{text}</td><td className={`pt-v${i === ECONOMICS.length - 1 ? ' red' : ''}`}>{value}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="cta-row">
            <a className="btn primary" href="/patient.html" data-rev style={d(0)}>Talk to Rafeeq as Fatima →</a>
            <a className="btn" href="/provider.html" data-rev style={d(80)}>Open the care OS →</a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="band band-faq">
        <div className="band-inner">
          <div className="label" data-rev>05 · Questions</div>
          {FAQ.map(([q, a], i) => <details key={q} data-rev style={d(i * 60)}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>

      <footer className="lp-foot">
        <div className="band-inner foot-grid">
          <div className="foot-brand" data-rev>Rafeeq <span>رفيق</span></div>
          <div className="foot-col">
            <a href="/patient.html" data-rev style={d(0)}>Patient agent</a>
            <a href="/provider.html" data-rev style={d(60)}>Care OS</a>
          </div>
          <div className="foot-col label light">
            <span data-rev style={d(0)}>Abu Dhabi · 2026</span>
            <span data-rev style={d(60)}>Synthetic data · not medical advice</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
