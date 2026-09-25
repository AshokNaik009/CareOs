// Landing: the pitch as a scroll story. Markup only; all motion lives in choreography.js.
import { useEffect, useRef } from 'react';
import Split from './Split.jsx';
import { mountChoreography } from './choreography.js';

const d = (ms) => ({ '--d': `${ms}ms` });

const RAIL = [
  { plate: 'helix', label: 'Genes × medicine', title: 'Her heart pill may not work', meta: 'Her genes stop this drug from working · the stent is less protected', mark: '■ Urgent · 10 months unchecked' },
  { plate: 'lung', label: 'Missed follow-up', title: 'Lung spot, no follow-up scan', meta: 'Small spot seen on a scan · re-check advised · never booked', mark: '■ Urgent · 8 months' },
  { plate: 'pulse', label: 'Smartwatch', title: '3 irregular heartbeat alerts', meta: 'Last 30 days · resting heart rate rising · no heart test since', mark: '■ Urgent' },
  { plate: 'drops', label: 'Blood test trend', title: 'Kidneys under strain', meta: 'Kidney function down by a quarter · no protective medicine', mark: '□ Soon' },
  { plate: 'bars', label: 'Blood test trend', title: 'Blood sugar keeps rising', meta: 'Four tests in a row, each higher · no specialist in 14 months', mark: '□ Soon' },
  { plate: 'eye', label: 'Lost referral', title: 'Eye check never booked', meta: 'Referral written 5 months ago · still not scheduled', mark: '□ Soon' },
];

const CUES = ['Spots what was missed', 'Explains it in Arabic', 'Gets insurance approval', 'Books the scan'];

const CHAPTERS = [
  { title: 'Help patients for free', text: 'A free assistant that knows your health history and follows up for you, offered through the government health app.' },
  { title: 'Get paid to keep them well', text: 'Insurers pay us a fixed monthly fee for each member with diabetes or heart failure.' },
  { title: 'Keep what we save', text: 'Catching problems early means fewer hospital stays. Every stay we prevent is money saved.' },
];

const ECONOMICS = [
  ['Members', 'People with diabetes or heart failure', '1,240'],
  ['We get paid', 'Per member, per month', 'AED 1,150'],
  ['Care cost before', 'Per member, per month', 'AED 1,080'],
  ['Care cost after', 'Per member, per month, with Rafeeq', 'AED 955'],
  ['Saved per year', 'Kept by us', 'AED 1.86M'],
];

const FAQ = [
  ['Is this real patient data?', 'No. All patients and numbers are made up for the demo. The voice assistant and the AI are real and working.'],
  ['Does Rafeeq diagnose or change medicines?', "No. It explains results, spots what was missed and sends medical decisions to the patient's doctor. In an emergency it tells people to call 998."],
  ['How does it find what was missed?', 'It checks the record against clear medical rules, like a follow-up scan that was never booked or a medicine that clashes with your genes. Every alert shows the evidence behind it.'],
  ['Why work with the government health app?', "Reaching people is the hard part. The app already has Abu Dhabi's residents, so Rafeeq lives inside it."],
];

export default function Landing() {
  const root = useRef(null);
  useEffect(() => mountChoreography(root.current), []);

  return (
    <div ref={root}>
      <header className="topbar lp-bar">
        <a className="brand" href="/" data-rev style={d(0)}>Rafeeq <span className="ar">رفيق</span></a>
        <nav className="nav">
          <a href="/patient.html" data-rev style={d(60)}>For patients</a>
          <a href="/provider.html" data-rev style={d(120)}>Care team</a>
          <a href="/live-health" data-rev style={d(180)}>Live Health</a>
        </nav>
        <div className="spacer"></div>
        <span className="demo-note" data-rev style={d(180)}>Built for Abu Dhabi</span>
      </header>

      {/* 1 · Poster hero */}
      <section className="stage stage-hero" id="hero" style={{ height: '280svh' }}>
        <div className="pin dark">
          <canvas className="field" data-canvas="field" aria-hidden="true"></canvas>
          <div className="lockup">
            <div className="poster-line small-line" style={{ '--chars': 26 }}>Your health, acted upon.</div>
            <div className="poster-line big-line" style={{ '--chars': 6 }}>Rafeeq</div>
            <div className="hero-sub label" data-rev style={d(300)}>A personal health agent for every Abu Dhabi resident</div>
            <div className="hero-actions">
              <a className="btn primary" href="/patient.html?p=P-1001&lang=en">Start Fatima’s demo →</a>
              <a className="btn" href="/provider.html?m=P-1001">See the care team view</a>
              <p>See what was missed. Fix it in one tap.</p>
              <span className="label light">Demo data only</span>
            </div>
          </div>
          <div className="hero-meta">
            {['Health record', 'Genes', 'Smartwatch', 'Arabic · English', 'Scroll ↓'].map((t, i) => <span key={t} data-rev style={d(i * 70)}>{t}</span>)}
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
          <Split as="p" className="manifesto-foot">Test results get filed. Doctors ask for follow-ups. Smartwatches spot odd heartbeats. It all sits in different places, and nobody puts it together.</Split>
        </div>
      </section>

      {/* 3 · Rail of findings */}
      <section className="stage stage-rail" id="rail" style={{ height: '340svh' }}>
        <div className="pin">
          <div className="rail-head">
            <Split as="h2" className="display rail-title">Warning signs, missed.</Split>
            <span className="label rail-hint" data-rev style={d(200)}>Scroll → one missed problem at a time</span>
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
            <Split as="h2" className="display packet-title">One sentence. Four things done.</Split>
            <Split as="p" className="packet-lede">Fatima says «احجزيها لي» (“book it for me”). Rafeeq explains the lung spot, gets insurance approval, books the scan and writes down her questions.</Split>
            <ol className="cues" data-cues>
              {CUES.map((t, i) => <li key={t} data-rev style={d(i * 80)}><span>{String(i + 1).padStart(2, '0')}</span>{t}</li>)}
            </ol>
            <div className="status-line label light" data-status-line>● Reading her health record…</div>
          </div>
          <div className="packet-wrap">
            <div className="packet">
              <div className="pk-head">
                <div className="label">Insurance approval</div>
                <div className="pk-name">Chest scan</div>
                <div className="label">Fatima Al Mansoori</div>
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
            <div className="label" data-rev>03 · The business</div>
            <Split as="h2" className="display season-title">Free for patients. Paid by insurers.</Split>
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
          <div className="label" data-rev>04 · The numbers (example)</div>
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
            <a className="btn" href="/provider.html" data-rev style={d(80)}>See the care team view →</a>
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
            <a href="/patient.html" data-rev style={d(0)}>For patients</a>
            <a href="/provider.html" data-rev style={d(60)}>Care team</a>
          </div>
          <div className="foot-col label light">
            <span data-rev style={d(0)}>Abu Dhabi · 2026</span>
            <span data-rev style={d(60)}>Demo data · not medical advice</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
