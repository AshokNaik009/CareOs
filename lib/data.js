// Synthetic demo data. Every date is relative to server start so the demo never goes stale.
// Nothing here is real patient data.

const DAY = 86400000;
const NOW = new Date();
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10);

const PATIENTS = {
  'P-1001': {
    id: 'P-1001',
    name: 'Fatima Al Mansoori',
    firstName: 'Fatima',
    age: 58,
    sex: 'F',
    preferredLang: 'ar',
    emiratesId: '784-1968-XXXXXXX-X',
    insurance: { payer: 'Thiqa', plan: 'Thiqa (UAE nationals)', memberId: 'TQ-XXXX-4471' },
    conditions: [
      { name: 'Type 2 diabetes', since: '2014' },
      { name: 'Hypertension', since: '2016' },
      { name: 'Coronary artery disease, stent (PCI) placed', since: daysAgo(300).slice(0, 4) },
      { name: 'High cholesterol', since: '2016' },
    ],
    medications: [
      { name: 'Metformin', dose: '1000 mg twice daily', class: 'metformin' },
      { name: 'Gliclazide MR', dose: '60 mg once daily', class: 'sulfonylurea' },
      { name: 'Clopidogrel', dose: '75 mg once daily', class: 'antiplatelet', drug: 'clopidogrel', started: daysAgo(300) },
      { name: 'Aspirin', dose: '81 mg once daily', class: 'antiplatelet' },
      { name: 'Atorvastatin', dose: '40 mg once daily', class: 'statin', drug: 'atorvastatin' },
      { name: 'Amlodipine', dose: '5 mg once daily', class: 'ccb' },
    ],
    labs: [
      { code: 'HBA1C', name: 'HbA1c', unit: '%', ref: '< 7.0', results: [[daysAgo(540), 7.1], [daysAgo(360), 7.6], [daysAgo(200), 8.1], [daysAgo(35), 8.9]] },
      { code: 'EGFR', name: 'eGFR (kidney function)', unit: 'mL/min/1.73m²', ref: '> 90', results: [[daysAgo(400), 84], [daysAgo(200), 72], [daysAgo(35), 63]] },
      { code: 'UACR', name: 'Urine albumin/creatinine ratio', unit: 'mg/g', ref: '< 30', results: [[daysAgo(400), 22], [daysAgo(35), 48]] },
      { code: 'LDL', name: 'LDL cholesterol', unit: 'mmol/L', ref: '< 1.4 (after heart stent)', results: [[daysAgo(200), 2.6], [daysAgo(35), 2.9]] },
      { code: 'K', name: 'Potassium', unit: 'mmol/L', ref: '3.5 – 5.1', results: [[daysAgo(35), 4.4]] },
    ],
    encounters: [
      { date: daysAgo(35), type: 'Primary care', specialty: 'Family medicine', provider: 'Family medicine clinic', note: 'Routine diabetes review. Labs ordered.' },
      { date: daysAgo(90), type: 'Emergency', specialty: 'Emergency', provider: 'Emergency department', note: 'Chest discomfort. Troponin negative x2. Discharged, advised cardiology follow-up.' },
      { date: daysAgo(240), type: 'Outpatient', specialty: 'Cardiology', provider: 'Cardiology clinic', note: 'Post-stent review. ECG sinus rhythm. Continue dual antiplatelet therapy 12 months.' },
      { date: daysAgo(420), type: 'Outpatient', specialty: 'Endocrinology', provider: 'Diabetes centre', note: 'HbA1c 7.1%. Continue current regimen.' },
    ],
    imaging: [
      {
        date: daysAgo(250), modality: 'CT chest', reason: 'Chest pain work-up',
        impression: 'No acute findings. Incidental 7 mm solid nodule, right upper lobe.',
        recommendation: { text: 'Follow-up CT chest in 6–12 months (Fleischner guideline).', modality: 'CT chest', minMonths: 6, maxMonths: 12 },
      },
    ],
    ecgs: [{ date: daysAgo(240), result: 'Sinus rhythm, 74 bpm' }],
    referrals: [
      { date: daysAgo(150), specialty: 'Ophthalmology', reason: 'Diabetic eye (retina) screening, last done over 2 years ago', status: 'not scheduled' },
    ],
    genome: {
      source: 'Emirati Genome Programme report (simulated)',
      date: daysAgo(500),
      variants: [
        { gene: 'CYP2C19', genotype: '*2/*2', phenotype: 'Poor metabolizer' },
        { gene: 'SLCO1B1', genotype: 'rs4149056 T/C', phenotype: 'Decreased function' },
        { gene: 'TCF7L2', genotype: 'rs7903146 C/T', phenotype: 'Increased type 2 diabetes risk (informational)' },
      ],
    },
    wearable: {
      device: 'Smartwatch (synced)',
      restingHr: [[daysAgo(30), 72], [daysAgo(20), 75], [daysAgo(10), 79], [daysAgo(1), 81]],
      stepsAvg7d: 3100,
      sleepAvg7d: '5 h 40 min',
      irregularRhythmAlerts: [daysAgo(19), daysAgo(11), daysAgo(4)],
    },
    preauthRequired: ['CT chest', 'Holter monitor'],
  },

  'P-2002': {
    id: 'P-2002',
    name: 'Rahul Menon',
    firstName: 'Rahul',
    age: 44,
    sex: 'M',
    preferredLang: 'en',
    emiratesId: '784-1982-XXXXXXX-X',
    insurance: { payer: 'Daman', plan: 'Daman Enhanced', memberId: 'DM-XXXX-9120' },
    conditions: [{ name: 'Prediabetes', since: daysAgo(400).slice(0, 4) }],
    medications: [],
    labs: [
      { code: 'HBA1C', name: 'HbA1c', unit: '%', ref: '< 5.7', results: [[daysAgo(400), 5.9], [daysAgo(60), 6.2]] },
      { code: 'LDL', name: 'LDL cholesterol', unit: 'mmol/L', ref: '< 3.0', results: [[daysAgo(400), 4.4], [daysAgo(60), 4.9]] },
      { code: 'EGFR', name: 'eGFR (kidney function)', unit: 'mL/min/1.73m²', ref: '> 90', results: [[daysAgo(60), 98]] },
    ],
    encounters: [
      { date: daysAgo(60), type: 'Primary care', specialty: 'Family medicine', provider: 'Family medicine clinic', note: 'Annual check. Lifestyle advice for prediabetes.' },
    ],
    imaging: [],
    ecgs: [],
    referrals: [],
    genome: {
      source: 'Direct-to-consumer genome report (uploaded by patient)',
      date: daysAgo(200),
      variants: [
        { gene: 'LDLR', genotype: 'c.681C>G heterozygous', phenotype: 'Pathogenic variant — familial hypercholesterolemia' },
        { gene: 'CYP2C19', genotype: '*1/*1', phenotype: 'Normal metabolizer' },
      ],
    },
    wearable: {
      device: 'Fitness band (synced)',
      restingHr: [[daysAgo(30), 64], [daysAgo(1), 63]],
      stepsAvg7d: 9200,
      sleepAvg7d: '6 h 50 min',
      irregularRhythmAlerts: [],
    },
    preauthRequired: [],
  },
};

// ---------- Population (idea 2: risk-bearing provider) ----------

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTRACT = {
  payer: 'Daman (incl. Thiqa members)',
  label: 'Illustrative contract',
  cohort: 'Type 2 diabetes and heart failure',
  members: 1240,
  capitationPmpm: 1150,          // AED paid to us per member per month
  baselineCostPmpm: 1080,        // AED medical cost PMPM before program
  avgAdmissionCost: 42000,       // AED
  outreachRiskReduction: 0.3,    // assumed relative reduction in 90-day admission risk after a gap is closed
};

// 12 months of medical cost PMPM; program goes live at month 6.
function costSeries() {
  const rnd = mulberry32(7);
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(NOW.getFullYear(), NOW.getMonth() - i, 1);
    const monthIdx = 11 - i;
    const trend = monthIdx < 6 ? CONTRACT.baselineCostPmpm : CONTRACT.baselineCostPmpm - (monthIdx - 5) * 24;
    out.push({ month: d.toLocaleString('en', { month: 'short' }), cost: Math.round(trend + (rnd() - 0.5) * 40), live: monthIdx >= 6 });
  }
  return out;
}

const GAPS = {
  a1c: 'HbA1c above 9% with no diabetes visit in 6 months',
  chf7: 'No follow-up within 7 days of heart failure discharge',
  eye: 'No diabetic eye screening in 24 months',
  img: 'Imaging follow-up recommended but never ordered',
  refill: 'Statin not refilled for 60+ days',
  weight: 'Connected scale: +2.1 kg in 3 days (fluid retention risk)',
  ed: 'Two emergency visits in the last 90 days',
  uacr: 'Kidney protein high, not on kidney-protective medicine',
  pgx: 'Gene–drug interaction on current medicine',
  rhythm: 'Repeated irregular heart rhythm alerts from smartwatch',
};

const NAMES = [
  ['Khalid Al Hammadi', 'M', 'ar'], ['Mariam Al Ketbi', 'F', 'ar'], ['Ahmed Abduljawad', 'M', 'ar'], ['Aisha Al Dhaheri', 'F', 'ar'],
  ['Hamad Al Mazrouei', 'M', 'ar'], ['Noura Al Shamsi', 'F', 'ar'], ['Omar Haddad', 'M', 'ar'], ['Layla Nasser', 'F', 'ar'],
  ['Joseph Mathew', 'M', 'en'], ['Anjali Nair', 'F', 'en'], ['Imran Qureshi', 'M', 'en'], ['Grace Santos', 'F', 'en'],
  ['Yousef Al Blooshi', 'M', 'ar'], ['Salama Al Qubaisi', 'F', 'ar'], ['Rashid Al Falasi', 'M', 'ar'], ['Hessa Al Suwaidi', 'F', 'ar'],
  ['David Okafor', 'M', 'en'], ['Priya Sharma', 'F', 'en'], ['Tariq Mahmood', 'M', 'en'], ['Maria Reyes', 'F', 'en'],
  ['Sultan Al Kaabi', 'M', 'ar'], ['Shamma Al Mheiri', 'F', 'ar'], ['Ali Al Marzooqi', 'M', 'ar'], ['Fatma Al Rumaithi', 'F', 'ar'],
  ['Arun Pillai', 'M', 'en'], ['Sarah Collins', 'F', 'en'], ['Bilal Ahmed', 'M', 'en'], ['Reem Khoury', 'F', 'ar'],
  ['Mohammed Al Ameri', 'M', 'ar'], ['Mouza Al Hosani', 'F', 'ar'], ['Faisal Al Awadhi', 'M', 'ar'], ['Elena Petrova', 'F', 'en'],
  ['Ahmed Al Zaabi', 'M', 'ar'], ['Latifa Al Neyadi', 'F', 'ar'], ['Vikram Rao', 'M', 'en'], ['Hind Al Muhairi', 'F', 'ar'],
  ['Kareem Saleh', 'M', 'ar'], ['Deepa Iyer', 'F', 'en'], ['Nasser Al Junaibi', 'M', 'ar'],
];

// Arabic spellings, so the Arabic agents say names the way an Arabic speaker would.
const AR_NAMES = {
  'Fatima Al Mansoori': 'فاطمة المنصوري', 'Rahul Menon': 'راهول مينون',
  'Khalid Al Hammadi': 'خالد الحمادي', 'Mariam Al Ketbi': 'مريم الكتبي', 'Ahmed Abduljawad': 'أحمد عبدالجواد', 'Aisha Al Dhaheri': 'عائشة الظاهري',
  'Hamad Al Mazrouei': 'حمد المزروعي', 'Noura Al Shamsi': 'نورة الشامسي', 'Omar Haddad': 'عمر حداد', 'Layla Nasser': 'ليلى ناصر',
  'Joseph Mathew': 'جوزيف ماثيو', 'Anjali Nair': 'أنجالي ناير', 'Imran Qureshi': 'عمران قريشي', 'Grace Santos': 'غريس سانتوس',
  'Yousef Al Blooshi': 'يوسف البلوشي', 'Salama Al Qubaisi': 'سلامة القبيسي', 'Rashid Al Falasi': 'راشد الفلاسي', 'Hessa Al Suwaidi': 'حصة السويدي',
  'David Okafor': 'ديفيد أوكافور', 'Priya Sharma': 'بريا شارما', 'Tariq Mahmood': 'طارق محمود', 'Maria Reyes': 'ماريا رييس',
  'Sultan Al Kaabi': 'سلطان الكعبي', 'Shamma Al Mheiri': 'شمة المهيري', 'Ali Al Marzooqi': 'علي المرزوقي', 'Fatma Al Rumaithi': 'فاطمة الرميثي',
  'Arun Pillai': 'أرون بيلاي', 'Sarah Collins': 'سارة كولينز', 'Bilal Ahmed': 'بلال أحمد', 'Reem Khoury': 'ريم خوري',
  'Mohammed Al Ameri': 'محمد العامري', 'Mouza Al Hosani': 'موزة الحوسني', 'Faisal Al Awadhi': 'فيصل العوضي', 'Elena Petrova': 'إيلينا بتروفا',
  'Ahmed Al Zaabi': 'أحمد الزعابي', 'Latifa Al Neyadi': 'لطيفة النيادي', 'Vikram Rao': 'فيكرام راو', 'Hind Al Muhairi': 'هند المهيري',
  'Kareem Saleh': 'كريم صالح', 'Deepa Iyer': 'ديبا أيير', 'Nasser Al Junaibi': 'ناصر الجنيبي',
};

// { name, firstName } for the agent's language; falls back to the English name if no Arabic spelling exists.
function namesFor(person, lang) {
  const ar = lang === 'ar' && AR_NAMES[person.name];
  return ar ? { name: ar, firstName: ar.split(' ')[0] } : { name: person.name, firstName: person.firstName };
}

function buildPopulation() {
  const rnd = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const members = NAMES.map(([name, sex, lang], i) => {
    const cond = pick(['T2DM', 'T2DM', 'CHF', 'T2DM + CHF']);
    const pool = cond === 'T2DM' ? ['a1c', 'eye', 'uacr', 'refill', 'ed', 'img']
      : cond === 'CHF' ? ['chf7', 'weight', 'refill', 'ed', 'rhythm']
        : ['a1c', 'chf7', 'weight', 'uacr', 'eye', 'ed', 'refill'];
    const n = 1 + Math.floor(rnd() * 3);
    const gaps = [];
    while (gaps.length < n) { const g = pick(pool); if (!gaps.includes(g)) gaps.push(g); }
    const pAdmit = Math.min(0.45, 0.03 + gaps.length * 0.05 + (cond.includes('CHF') ? 0.08 : 0) + rnd() * 0.1);
    return {
      id: `M-${3001 + i}`, name, firstName: name.split(' ')[0], sex, lang,
      age: 42 + Math.floor(rnd() * 36), cohort: cond,
      gaps: gaps.map((g) => GAPS[g]),
      pAdmit90: Math.round(pAdmit * 100) / 100,
      lastContactDays: 20 + Math.floor(rnd() * 200),
      status: 'open',
      outcome: null,
    };
  });
  // The patient-agent hero is also a member of the risk contract: this is where the two ideas meet.
  members.push({
    id: 'P-1001', name: 'Fatima Al Mansoori', firstName: 'Fatima', sex: 'F', lang: 'ar', age: 58, cohort: 'T2DM',
    gaps: [GAPS.pgx, GAPS.img, GAPS.uacr, GAPS.rhythm, GAPS.eye],
    pAdmit90: 0.38, lastContactDays: 35, status: 'open', outcome: null, linkedPatientAgent: true,
  });
  for (const m of members) m.riskScore = Math.round(m.pAdmit90 * 200 + m.gaps.length * 4);
  members.sort((a, b) => b.riskScore - a.riskScore);
  return members;
}

const PROGRAM_BENEFITS = 'No copay for visits booked through this program; free transport to the clinic; home blood draw available; evening and Saturday appointments.';

module.exports = { PATIENTS, CONTRACT, GAPS, PROGRAM_BENEFITS, AR_NAMES, namesFor, buildPopulation, costSeries, daysAgo, NOW, DAY };
