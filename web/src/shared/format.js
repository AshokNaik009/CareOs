export const aed = (n) => `AED ${Math.round(n).toLocaleString('en-US')}`;
export const aedShort = (n) => (n >= 1e6 ? `AED ${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `AED ${(n / 1e3).toFixed(0)}K` : aed(n));
export const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('');

export function micHint(err) {
  const m = String((err && err.message) || err);
  if (/Permission|NotAllowed|denied/i.test(m)) return 'Microphone blocked. Allow mic access in the browser, or use "Type instead".';
  if (/NotFound|device/i.test(m)) return 'No microphone found. Use "Type instead".';
  return m;
}
