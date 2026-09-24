// Missed-findings safety net: deterministic, explainable rules over the record.
// Every finding carries the evidence it was derived from, so a clinician can verify it.

const { NOW, DAY } = require('./data');

const daysSince = (iso) => Math.floor((NOW.getTime() - new Date(iso).getTime()) / DAY);
const latest = (lab) => lab && lab.results[lab.results.length - 1];
const first = (lab) => lab && lab.results[0];
const lab = (p, code) => p.labs.find((l) => l.code === code);
const onClass = (p, ...classes) => p.medications.some((m) => classes.includes(m.class));
const onDrug = (p, drug) => p.medications.find((m) => m.drug === drug);
const variant = (p, gene) => p.genome && p.genome.variants.find((v) => v.gene === gene);
const seenSpecialty = (p, specialty, withinDays) =>
  p.encounters.some((e) => e.specialty === specialty && daysSince(e.date) <= withinDays);

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function findingsFor(p) {
  const out = [];

  // 1. Gene–drug interactions (CPIC guidance)
  const cyp = variant(p, 'CYP2C19');
  const clop = onDrug(p, 'clopidogrel');
  if (cyp && clop && /poor|intermediate/i.test(cyp.phenotype)) {
    const poor = /poor/i.test(cyp.phenotype);
    out.push({
      id: 'pgx-clopidogrel', severity: poor ? 'high' : 'medium', category: 'Genome × medication',
      title: `Clopidogrel may not work well with ${p.firstName}'s genes`,
      plain: `The genome report shows ${cyp.gene} ${cyp.genotype} (${cyp.phenotype.toLowerCase()}). People with this result activate clopidogrel poorly, so it may protect the heart stent less than expected. Guidelines (CPIC) suggest the cardiologist consider an alternative. Do not stop any medicine without your doctor.`,
      evidence: [`Genome: ${cyp.gene} ${cyp.genotype} — ${cyp.phenotype}`, `Medication: ${clop.name} ${clop.dose}, since ${clop.started}`, 'Nobody has reviewed this interaction: no cardiology note mentions it'],
      action: { type: 'notify', specialty: 'Cardiology', label: 'Alert cardiologist' },
    });
  }
  const slco = variant(p, 'SLCO1B1');
  const statin = p.medications.find((m) => m.class === 'statin');
  if (slco && /decreased|poor/i.test(slco.phenotype) && statin && statin.drug === 'simvastatin') {
    out.push({
      id: 'pgx-statin', severity: 'medium', category: 'Genome × medication',
      title: 'Statin type may raise muscle side-effect risk',
      plain: `SLCO1B1 decreased function raises the risk of muscle side effects with simvastatin. The doctor may prefer a different statin.`,
      evidence: [`Genome: SLCO1B1 ${slco.genotype}`, `Medication: ${statin.name} ${statin.dose}`],
      action: { type: 'notify', specialty: 'Family medicine', label: 'Flag to doctor' },
    });
  }
  const ldlr = variant(p, 'LDLR');
  const ldl = lab(p, 'LDL');
  if (ldlr && /pathogenic/i.test(ldlr.phenotype) && !onClass(p, 'statin')) {
    out.push({
      id: 'fh-untreated', severity: 'high', category: 'Genome × labs',
      title: 'Inherited high cholesterol found in genome, not being treated',
      plain: `The genome report shows a disease-causing LDLR variant, which means familial hypercholesterolemia: cholesterol is high from birth, raising heart risk early. LDL is ${latest(ldl)[1]} ${ldl.unit} and rising, and no cholesterol medicine is prescribed. A lipid specialist should review, and close family members should be offered testing.`,
      evidence: [`Genome: ${ldlr.gene} ${ldlr.genotype} — ${ldlr.phenotype}`, `LDL ${first(ldl)[1]} → ${latest(ldl)[1]} ${ldl.unit} (ref ${ldl.ref})`, 'No statin on medication list', 'Genome report never linked to the clinical record'],
      action: { type: 'book', specialty: 'Lipid clinic (cardiology)', label: 'Book lipid clinic' },
    });
  }

  // 2. Imaging recommendations that were never actioned
  for (const img of p.imaging) {
    const rec = img.recommendation;
    if (!rec) continue;
    const months = daysSince(img.date) / 30.4;
    const followed = p.imaging.some((o) => o !== img && o.modality === rec.modality && o.date > img.date);
    if (!followed && months >= rec.minMonths) {
      const overdue = months > rec.maxMonths;
      out.push({
        id: `img-${img.date}`, severity: 'high', category: 'Missed follow-up',
        title: `${rec.modality} follow-up ${overdue ? 'overdue' : 'due now'} — never ordered`,
        plain: `A ${img.modality} ${Math.round(months)} months ago found: "${img.impression}" The radiologist recommended: "${rec.text}" No follow-up scan has been ordered. Most small nodules are harmless, but the check matters.`,
        evidence: [`${img.modality} ${img.date}: ${img.impression}`, `Radiologist: ${rec.text}`, `No ${rec.modality} ordered since (${Math.round(months)} months)`],
        action: { type: 'book', specialty: 'Radiology', label: `Book ${rec.modality}` },
        preauth: p.preauthRequired.includes(rec.modality) ? rec.modality : null,
      });
    }
  }

  // 3. Heart rhythm alerts from the wearable with no ECG since
  const irn = (p.wearable && p.wearable.irregularRhythmAlerts) || [];
  const recent = irn.filter((d) => daysSince(d) <= 30);
  if (recent.length >= 2) {
    const firstAlert = recent.slice().sort()[0];
    const ecgSince = p.ecgs.some((e) => e.date >= firstAlert);
    if (!ecgSince) {
      out.push({
        id: 'rhythm', severity: 'high', category: 'Wearable signal',
        title: `${recent.length} irregular-rhythm alerts in 30 days, no ECG since`,
        plain: `The watch flagged an irregular heart rhythm ${recent.length} times in the last month, and resting heart rate went from ${p.wearable.restingHr[0][1]} to ${p.wearable.restingHr[p.wearable.restingHr.length - 1][1]}. This can be atrial fibrillation, which raises stroke risk and is very treatable. It needs a proper ECG or Holter check.`,
        evidence: [`Watch alerts: ${recent.join(', ')}`, `Resting HR ${p.wearable.restingHr[0][1]} → ${p.wearable.restingHr[p.wearable.restingHr.length - 1][1]} bpm`, p.ecgs.length ? `Last ECG ${p.ecgs[p.ecgs.length - 1].date}: ${p.ecgs[p.ecgs.length - 1].result}` : 'No ECG on record'],
        action: { type: 'book', specialty: 'Cardiology', label: 'Book ECG / Holter' },
        preauth: p.preauthRequired.includes('Holter monitor') ? 'Holter monitor' : null,
      });
    }
  }

  // 4. Kidney: albumin in urine or falling eGFR, without kidney-protective medicine
  const uacr = lab(p, 'UACR');
  const egfr = lab(p, 'EGFR');
  const uacrHigh = uacr && latest(uacr)[1] >= 30;
  const egfrDrop = egfr && egfr.results.length > 1 ? (first(egfr)[1] - latest(egfr)[1]) / first(egfr)[1] : 0;
  if ((uacrHigh || egfrDrop >= 0.15) && !onClass(p, 'acei', 'arb', 'sglt2i')) {
    out.push({
      id: 'kidney', severity: 'medium', category: 'Lab trend',
      title: 'Early kidney strain, not on kidney-protective medicine',
      plain: `Kidney function (eGFR) fell from ${first(egfr)[1]} to ${latest(egfr)[1]}${uacrHigh ? `, and there is protein in the urine (${latest(uacr)[1]} mg/g, normal is under 30)` : ''}. In diabetes, doctors often add medicines that protect the kidneys. This is worth raising at the next visit.`,
      evidence: [`eGFR ${egfr.results.map((r) => r[1]).join(' → ')} ${egfr.unit}`, uacr ? `UACR ${latest(uacr)[1]} mg/g (ref ${uacr.ref})` : null, 'No ACE inhibitor, ARB or SGLT2 inhibitor on medication list'].filter(Boolean),
      action: { type: 'book', specialty: 'Endocrinology', label: 'Raise with diabetes doctor' },
    });
  }

  // 5. Glycaemic control worsening with no specialist visit
  const a1c = lab(p, 'HBA1C');
  if (a1c && p.conditions.some((c) => /diabetes/i.test(c.name))) {
    const v = latest(a1c)[1];
    const prev = a1c.results.length > 1 ? a1c.results[a1c.results.length - 2][1] : v;
    if (v >= 8 && v > prev && !seenSpecialty(p, 'Endocrinology', 180)) {
      const lastEndo = p.encounters.filter((e) => e.specialty === 'Endocrinology').map((e) => e.date).sort().pop();
      out.push({
        id: 'a1c', severity: v >= 9 ? 'high' : 'medium', category: 'Lab trend',
        title: `HbA1c rising to ${v}% with no diabetes specialist visit`,
        plain: `HbA1c is the 3-month average blood sugar. It went ${a1c.results.map((r) => r[1]).join(' → ')}%, and the target is under 7. The last diabetes specialist visit was ${lastEndo ? `${Math.round(daysSince(lastEndo) / 30.4)} months ago` : 'never'}.`,
        evidence: [`HbA1c ${a1c.results.map((r) => `${r[1]}% (${r[0]})`).join(' → ')}`, lastEndo ? `Last endocrinology visit ${lastEndo}` : 'No endocrinology visit on record'],
        action: { type: 'book', specialty: 'Endocrinology', label: 'Book diabetes doctor' },
      });
    }
  }

  // 6. LDL above target after a heart stent
  if (ldl && onClass(p, 'statin') && p.conditions.some((c) => /coronary|stent/i.test(c.name)) && latest(ldl)[1] >= 1.4) {
    out.push({
      id: 'ldl', severity: 'medium', category: 'Lab trend',
      title: `LDL ${latest(ldl)[1]} mmol/L, above target after a heart stent`,
      plain: `After a heart stent the usual LDL target is under 1.4 mmol/L. It is ${latest(ldl)[1]} and went up since last time. The doctor may adjust treatment.`,
      evidence: [`LDL ${ldl.results.map((r) => r[1]).join(' → ')} mmol/L (target ${ldl.ref})`],
      action: { type: 'notify', specialty: 'Cardiology', label: 'Flag to cardiologist' },
    });
  }

  // 7. Referrals that were written but never booked
  for (const r of p.referrals) {
    if (r.status === 'not scheduled' && daysSince(r.date) > 30) {
      out.push({
        id: `ref-${r.specialty}`, severity: 'medium', category: 'Missed follow-up',
        title: `${r.specialty} referral from ${Math.round(daysSince(r.date) / 30.4)} months ago never booked`,
        plain: `A referral was written for: ${r.reason}. It was never scheduled.`,
        evidence: [`Referral ${r.date} → ${r.specialty}: ${r.reason}`, 'Status: not scheduled'],
        action: { type: 'book', specialty: r.specialty, label: `Book ${r.specialty}` },
      });
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Compact plain-text record handed to the voice agent as a dynamic variable.
function contextFor(p) {
  const f = findingsFor(p);
  const lines = [];
  lines.push(`PATIENT: ${p.name}, ${p.age}, ${p.sex === 'F' ? 'female' : 'male'}. Insurance: ${p.insurance.plan} (member ${p.insurance.memberId}).`);
  lines.push(`CONDITIONS: ${p.conditions.map((c) => `${c.name} (since ${c.since})`).join('; ')}.`);
  lines.push(`MEDICATIONS: ${p.medications.length ? p.medications.map((m) => `${m.name} ${m.dose}`).join('; ') : 'none'}.`);
  lines.push('LABS (oldest → newest):');
  for (const l of p.labs) lines.push(`- ${l.name}: ${l.results.map((r) => `${r[1]} on ${r[0]}`).join(', ')} ${l.unit}. Reference ${l.ref}.`);
  lines.push('ENCOUNTERS:');
  for (const e of p.encounters) lines.push(`- ${e.date} ${e.type} — ${e.specialty}: ${e.note}`);
  for (const i of p.imaging) lines.push(`IMAGING ${i.date} ${i.modality}: ${i.impression} Recommendation: ${i.recommendation ? i.recommendation.text : 'none'}`);
  for (const e of p.ecgs) lines.push(`ECG ${e.date}: ${e.result}`);
  for (const r of p.referrals) lines.push(`REFERRAL ${r.date} to ${r.specialty}: ${r.reason}. Status: ${r.status}.`);
  if (p.genome) lines.push(`GENOME (${p.genome.source}): ${p.genome.variants.map((v) => `${v.gene} ${v.genotype} = ${v.phenotype}`).join('; ')}.`);
  if (p.wearable) {
    const w = p.wearable;
    lines.push(`WEARABLE (${w.device}): resting HR ${w.restingHr.map((r) => r[1]).join(' → ')} bpm over 30 days; steps ${w.stepsAvg7d}/day; sleep ${w.sleepAvg7d}; irregular-rhythm alerts: ${w.irregularRhythmAlerts.length ? w.irregularRhythmAlerts.join(', ') : 'none'}.`);
  }
  lines.push(`PROCEDURES NEEDING INSURANCE PRE-AUTHORIZATION: ${p.preauthRequired.length ? p.preauthRequired.join(', ') : 'none'}.`);
  lines.push('');
  lines.push('AGENT FINDINGS (safety-net engine, most important first):');
  f.forEach((x, i) => lines.push(`${i + 1}. [${x.severity.toUpperCase()}] ${x.title}. ${x.plain} Suggested action: ${x.action.label}${x.preauth ? ` (needs pre-authorization for ${x.preauth})` : ''}.`));
  return lines.join('\n');
}

module.exports = { findingsFor, contextFor, daysSince };
