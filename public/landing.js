// Landing choreography: one scroll handler writes CSS custom properties; CSS does the rest.
(function () {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const set = (k, v) => root.style.setProperty(k, v);
  const INK = '#171717', RED = '#ef493c';

  // ---------- per-word split + reveal ----------
  document.querySelectorAll('[data-split]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.style.setProperty('--i', i);
      s.textContent = w;
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-rev], [data-split]').forEach((el) => io.observe(el));

  // ---------- stage progress ----------
  const stages = {};
  for (const id of ['hero', 'manifesto', 'rail', 'packet', 'season']) stages[id] = document.getElementById(id);
  const progressOf = (el) => {
    const r = el.getBoundingClientRect();
    const span = el.offsetHeight - innerHeight;
    return span > 0 ? clamp(-r.top / span) : 0;
  };

  const track = document.getElementById('railTrack');
  let railOverflow = 0;
  const measure = () => {
    railOverflow = Math.max(0, track.scrollWidth - innerWidth);
    set('--rail-overflow', `${railOverflow}px`);
  };

  // artifact phases: DOM text changes only when the index changes
  const cues = [...document.querySelectorAll('#cues li')];
  const statusLine = document.getElementById('statusLine');
  const pk = { ref: document.getElementById('pkRef'), status: document.getElementById('pkStatus'), date: document.getElementById('pkDate') };
  const d = new Date(Date.now() + 5 * 864e5);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const booked = `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · 10:30`;
  const PHASES = [
    { status: '● Reading Malaffi record…', ref: 'PA-·····', st: 'pending', date: '— · —' },
    { status: '● Found: 7 mm nodule, follow-up never ordered', ref: 'PA-·····', st: 'pending', date: '— · —' },
    { status: '● Explaining to Fatima in Arabic…', ref: 'PA-·····', st: 'pending', date: '— · —' },
    { status: '● Pre-auth filed with Thiqa', ref: 'PA-95212', st: 'submitted', date: '— · —' },
    { status: '● Booked. Visit sheet ready.', ref: 'PA-95212', st: 'submitted', date: booked },
  ];
  let phase = -1;
  function setPhase(i) {
    if (i === phase) return;
    phase = i;
    cues.forEach((c, k) => c.classList.toggle('lit', k < i));
    const p = PHASES[i];
    statusLine.textContent = p.status;
    pk.ref.textContent = p.ref; pk.status.textContent = p.st; pk.date.textContent = p.date;
  }

  const chapters = [...document.querySelectorAll('#chapters .chapter')];
  let chapter = -1;
  const bar = document.querySelector('.lp-bar');

  function onScroll() {
    if (reduced) return;
    // 1 · hero: three independent curves
    const h = progressOf(stages.hero);
    set('--hero-type-y', `${(-90 * h).toFixed(1)}px`);
    set('--hero-type-scale', (1 - 0.26 * h).toFixed(4));
    set('--hero-type-alpha', clamp(1 - (h - 0.15) / 0.75).toFixed(3));
    set('--hero-meta-alpha', clamp(1 - h * 2.2).toFixed(3));
    bar.classList.toggle('solid', stages.hero.getBoundingClientRect().bottom < 80);

    // 2 · manifesto wipe
    const m = progressOf(stages.manifesto);
    set('--manifesto-wipe', `${(clamp((m - 0.08) / 0.8) * 100).toFixed(2)}%`);
    set('--manifesto-scale', (1 + 0.05 * m).toFixed(4));

    // 3 · rail
    set('--rail-p', progressOf(stages.rail).toFixed(4));

    // 4 · packet
    const k = progressOf(stages.packet);
    const a = clamp(k / 0.18);
    set('--packet-alpha', a.toFixed(3));
    set('--packet-enter', `${(38 * (1 - a)).toFixed(1)}px`);
    set('--packet-scale', (0.78 + 0.22 * a).toFixed(4));
    set('--packet-cut', clamp((k - 0.84) / 0.14).toFixed(3));
    set('--packet-meter', k.toFixed(4));
    set('--packet-copy-x', `${(-24 * a).toFixed(1)}px`);
    setPhase(Math.min(4, Math.floor(clamp((k - 0.1) / 0.72) * 5)));

    // 5 · season
    const s = progressOf(stages.season);
    set('--season-y', `${(-4 + 8 * s).toFixed(2)}%`);
    set('--season-scale', (1.1 - 0.045 * s).toFixed(4));
    const c = Math.min(2, Math.floor(s * 3));
    if (c !== chapter) { chapter = c; chapters.forEach((el, i) => el.classList.toggle('on', i === c)); }
  }

  if (reduced) {
    setPhase(4);
    chapters.forEach((el) => el.classList.add('on'));
    bar.classList.add('solid');
  }

  // ---------- canvases ----------
  const dpr = Math.min(2, devicePixelRatio || 1);
  function fit(cv) {
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  // tilled field of drifting red strokes
  const field = document.getElementById('field');
  function drawField(t) {
    const { ctx, w, h } = field._f;
    ctx.clearRect(0, 0, w, h);
    const gap = 26;
    let i = 0;
    for (let y = gap / 2; y < h; y += gap) {
      for (let x = gap / 2; x < w; x += gap) {
        i++;
        const ang = Math.sin(t * 0.0004 + i * 0.37) * 0.5 + Math.sin(y * 0.01 + t * 0.0002) * 0.4;
        const alpha = 0.05 + 0.14 * (0.5 + 0.5 * Math.sin(t * 0.0007 + i * 0.13));
        const len = 7 + 4 * Math.sin(i * 1.7);
        ctx.strokeStyle = `rgba(239,73,60,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang) * len / 2, y - Math.sin(ang) * len / 2);
        ctx.lineTo(x + Math.cos(ang) * len / 2, y + Math.sin(ang) * len / 2);
        ctx.stroke();
      }
    }
  }

  // contour plate: 22 stacked lines, every fifth in red
  const contours = document.getElementById('contours');
  function drawContours(t) {
    const { ctx, w, h } = contours._f;
    ctx.clearRect(0, 0, w, h);
    for (let n = 0; n < 22; n++) {
      const base = h * 0.06 + (n / 21) * h * 0.66;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = base + Math.sin(x * 0.006 + n * 0.45 + t * 0.00025) * 22 + Math.sin(x * 0.0017 - t * 0.00012 + n) * 34;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      const red = n % 5 === 0;
      ctx.strokeStyle = red ? RED : 'rgba(23,23,23,.22)';
      ctx.lineWidth = red ? 1.6 : 1;
      ctx.stroke();
    }
  }

  // static plates for cards and the artifact
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
  const PLATES = {
    helix(ctx, w, h) {
      for (let i = 0; i < 26; i++) {
        const y = h * 0.1 + (i / 25) * h * 0.8;
        const dx = Math.sin(i * 0.5) * w * 0.28;
        ctx.strokeStyle = 'rgba(23,23,23,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(w / 2 - dx, y); ctx.lineTo(w / 2 + dx, y); ctx.stroke();
        ctx.fillStyle = i === 13 ? RED : INK;
        ctx.fillRect(w / 2 - dx - 3, y - 3, 6, 6); ctx.fillRect(w / 2 + dx - 3, y - 3, 6, 6);
      }
    },
    lung(ctx, w, h) {
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      for (const s of [-1, 1]) {
        for (let r = 1; r <= 6; r++) {
          ctx.globalAlpha = 0.15 + r * 0.1;
          ctx.beginPath(); ctx.ellipse(w / 2 + s * w * 0.2, h * 0.52, w * 0.035 * r, h * 0.055 * r, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1; ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(w / 2 - w * 0.25, h * 0.36, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = RED; ctx.beginPath(); ctx.arc(w / 2 - w * 0.25, h * 0.36, 14, 0, Math.PI * 2); ctx.stroke();
    },
    pulse(ctx, w, h) {
      for (let row = 0; row < 5; row++) {
        const y0 = h * 0.18 + row * h * 0.16;
        ctx.strokeStyle = row === 2 ? RED : 'rgba(23,23,23,.6)'; ctx.lineWidth = row === 2 ? 2 : 1.2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const ph = (x + row * 37) % 70;
          const irregular = row === 2 && x > w * 0.4 && x < w * 0.7;
          let y = y0;
          if (ph > 30 && ph < 34) y -= (irregular ? 10 + 10 * Math.sin(x) : 22);
          else if (ph >= 34 && ph < 37) y += 8;
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    },
    drops(ctx, w, h) {
      const r = rng(11);
      for (let i = 0; i < 60; i++) {
        const x = r() * w, y = r() * h, s = 2 + r() * 7;
        ctx.fillStyle = i % 9 === 0 ? RED : `rgba(23,23,23,${(0.2 + r() * 0.6).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
    },
    bars(ctx, w, h) {
      const vals = [7.1, 7.6, 8.1, 8.9];
      const bw = w / 7;
      vals.forEach((v, i) => {
        const bh = (v - 5.5) / 4 * h * 0.75;
        ctx.fillStyle = i === 3 ? RED : INK;
        ctx.fillRect(bw * (1 + i * 1.4), h * 0.88 - bh, bw * 0.8, bh);
      });
      ctx.strokeStyle = INK; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      const ty = h * 0.88 - (7 - 5.5) / 4 * h * 0.75;
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(w, ty); ctx.stroke(); ctx.setLineDash([]);
    },
    eye(ctx, w, h) {
      for (let r = 1; r <= 9; r++) {
        ctx.strokeStyle = r === 3 ? RED : `rgba(23,23,23,${(0.15 + r * 0.06).toFixed(2)})`;
        ctx.lineWidth = r === 3 ? 2 : 1;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, r * Math.min(w, h) * 0.045, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.06, 0, Math.PI * 2); ctx.fill();
    },
    scan(ctx, w, h) {
      ctx.strokeStyle = 'rgba(23,23,23,.18)'; ctx.lineWidth = 1;
      for (let y = 6; y < h; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      PLATES.lung(ctx, w, h);
    },
  };
  const plates = [...document.querySelectorAll('canvas[data-plate]')];
  function drawPlates() {
    for (const cv of plates) {
      const { ctx, w, h } = fit(cv);
      ctx.clearRect(0, 0, w, h);
      PLATES[cv.dataset.plate](ctx, w, h);
    }
  }

  // animate canvases only while their stage is on screen
  const visible = new Set();
  const vio = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target))));
  vio.observe(field); vio.observe(contours);
  function loop(t) {
    if (visible.has(field)) drawField(reduced ? 0 : t);
    if (visible.has(contours)) drawContours(reduced ? 0 : t);
    if (!reduced) requestAnimationFrame(loop);
  }

  function resize() {
    field._f = fit(field);
    contours._f = fit(contours);
    drawPlates();
    measure();
    onScroll();
    if (reduced) { drawField(0); drawContours(0); }
  }

  let ticking = false;
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; onScroll(); }); } }, { passive: true });
  addEventListener('resize', resize);
  document.fonts && document.fonts.ready.then(resize);
  resize();
  setPhase(reduced ? 4 : 0);
  requestAnimationFrame(loop);
})();
