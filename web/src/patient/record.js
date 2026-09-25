// Pure helpers for the patient page.

// True when the latest lab value falls outside its reference ("< 5.7", "> 60" or "3.5 – 5.0").
export function badLab(l) {
  const v = l.results[l.results.length - 1][1];
  const ref = l.ref.match(/([<>])\s*([\d.]+)/);
  if (ref) return ref[1] === '<' ? v >= Number(ref[2]) : v <= Number(ref[2]);
  const range = l.ref.match(/([\d.]+)\s*–\s*([\d.]+)/);
  return range ? v < Number(range[1]) || v > Number(range[2]) : false;
}

// Words that show a finding has been acted on (matched against booking/pre-auth/alert text).
const HANDLED_BY = {
  'pgx-clopidogrel': ['clopidogrel', 'cyp2c19', 'antiplatelet'],
  rhythm: ['rhythm', 'ecg', 'holter', 'atrial', 'palpitation'],
  kidney: ['kidney', 'egfr', 'uacr', 'renal', 'albumin', 'nephro'],
  a1c: ['hba1c', 'a1c', 'glucose', 'glycemic', 'glycaemic', 'endocrin', 'diabetes'],
  ldl: ['ldl', 'cholesterol', 'lipid', 'statin'],
  'fh-untreated': ['lipid', 'cholesterol', 'ldlr', 'hypercholesterol'],
  img: ['ct', 'nodule', 'radiology', 'chest'],
  ref: ['ophthalm', 'eye', 'retina', 'retinal'],
};

// Reference number of the booking/pre-auth/alert that handled this finding, if any.
export function handledRef(f, data) {
  const key = f.id.startsWith('img') ? 'img' : f.id.startsWith('ref') ? 'ref' : f.id;
  const words = HANDLED_BY[key] || [];
  const items = [
    ...data.bookings.map((b) => ({ ref: b.ref, text: `${b.specialty} ${b.reason}` })),
    ...data.preauths.map((a) => ({ ref: a.ref, text: `${a.procedure} ${a.justification}` })),
    ...data.alerts.map((a) => ({ ref: a.ref, text: a.summary })),
  ];
  const hit = items.find((it) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(it.text)));
  return hit && hit.ref;
}
