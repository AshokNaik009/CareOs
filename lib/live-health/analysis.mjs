const DAY = 86400000;
export const shiftDate = (date, amount) => new Date(Date.parse(`${date}T12:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
const valid = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const round = value => Math.round(value * 10) / 10;
const metrics = ['recovery', 'hrv', 'resting_hr', 'sleep_hours', 'sleep_performance', 'sleep_efficiency', 'strain', 'spo2', 'respiratory_rate', 'skin_temp', 'kilojoule', 'average_hr'];
const values = (rows, key) => rows.map(d => d[key]).filter(valid);
const within = (rows, start, end) => rows.filter(d => d.date >= start && d.date < end);
const sample = (rows, key, minimum) => {
  const data = values(rows, key);
  return { average: data.length >= minimum ? mean(data) : null, count: data.length };
};
const ordered = (rows, today) => [...new Map(rows.filter(d => d.date <= today && d.date >= shiftDate(today, -30)).map(d => [d.date, d])).values()].sort((a, b) => a.date.localeCompare(b.date));

function trend(rows, today, key, tolerance) {
  const recent = values(within(rows, shiftDate(today, -2), shiftDate(today, 1)), key);
  const previous = values(within(rows, shiftDate(today, -9), shiftDate(today, -2)), key);
  if (recent.length !== 3 || previous.length < 4) return null;
  const baseline = mean(previous);
  const delta = mean(recent) - baseline;
  const limit = Math.max(Math.abs(baseline) * tolerance, key === 'resting_hr' ? 2 : key === 'sleep_hours' ? 0.3 : 1);
  const supportingDays = recent.filter(value => delta > 0 ? value > baseline + limit : value < baseline - limit).length;
  return Math.abs(delta) <= limit || supportingDays < 2 ? 'stable' : delta > 0 ? 'up' : 'down';
}

function healthFlags(rows, today) {
  const flags = [];
  const recent = within(rows, shiftDate(today, -6), shiftDate(today, 1));
  if (values(recent, 'spo2').filter(v => v < 92).length >= 2) flags.push('blood oxygen has been repeatedly low');
  const pulse = values(within(rows, shiftDate(today, -3), shiftDate(today, 1)), 'resting_hr');
  if (pulse.length === 4 && pulse.slice(1).every((v, i) => v - pulse[i] >= 2) && pulse[3] - pulse[0] >= Math.max(10, pulse[0] * 0.2)) flags.push('resting heart rate has risen sharply over consecutive days');
  const baseline = sample(within(rows, shiftDate(today, -30), shiftDate(today, -2)), 'respiratory_rate', 7).average;
  const breathing = values(within(rows, shiftDate(today, -2), shiftDate(today, 1)), 'respiratory_rate');
  const current = rows.find(d => d.date === today)?.respiratory_rate;
  if (valid(baseline) && ((breathing.length === 3 && breathing.every(v => v - baseline >= Math.max(3, baseline * 0.2))) || (valid(current) && current - baseline >= Math.max(5, baseline * 0.3)))) flags.push('sleep breathing rate is well above your usual level');
  return flags.length ? `Consider checking with a doctor: ${flags.join('; ')}. Wearable readings are not a diagnosis.` : null;
}

function patterns(rows) {
  const result = [];
  let strainPairs = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (next.date !== shiftDate(prev.date, 1)) continue;
    const prior = within(rows, shiftDate(prev.date, -7), prev.date);
    const strainBase = sample(prior, 'strain', 4).average;
    const recoveryBase = sample(prior, 'recovery', 4).average;
    if (!prev.cycle_open && valid(prev.strain) && valid(next.recovery) && valid(strainBase) && valid(recoveryBase) && prev.strain >= strainBase + 3 && next.recovery <= recoveryBase - 10) strainPairs++;
  }
  if (strainPairs >= 2) result.push(`On ${strainPairs} occasions, higher-strain days were followed by lower recovery than your earlier average; this is an association, not proof of cause.`);
  const nights = rows.filter(d => valid(d.sleep_hours) && valid(d.hrv));
  if (nights.length >= 10) {
    const sleepBase = mean(values(nights, 'sleep_hours'));
    const short = nights.filter(d => d.sleep_hours < sleepBase - 0.5);
    const other = nights.filter(d => d.sleep_hours >= sleepBase - 0.5);
    if (short.length >= 3 && other.length >= 3 && mean(values(short, 'hrv')) < mean(values(other, 'hrv')) * 0.9) result.push('Shorter nights have coincided with lower HRV, the variation in time between heartbeats; this does not establish a cause.');
  }
  return result;
}

export function buildReport(input, today, profile = {}) {
  const rows = ordered(input, today);
  const current = rows.find(d => d.date === today) ?? null;
  const week = within(rows, shiftDate(today, -7), today);
  const month = within(rows, shiftDate(today, -30), today);
  const baselines = Object.fromEntries(metrics.map(key => [key, { week: sample(week, key, 4), month: sample(month, key, 15) }]));
  const trends = {
    hrv: trend(rows, today, 'hrv', 0.1),
    resting_hr: trend(rows, today, 'resting_hr', 0.05),
    sleep: { up: 'improving', down: 'declining', stable: 'stable' }[trend(rows, today, 'sleep_hours', 0.05)] ?? null,
  };
  const status = !valid(current?.recovery) ? null : current.recovery >= 67 ? 'green' : current.recovery >= 34 ? 'yellow' : 'red';
  const insights = [];
  for (const [key, label, unit] of [['recovery', 'Recovery', '%'], ['hrv', 'HRV (variation in time between heartbeats)', 'ms'], ['resting_hr', 'Resting heart rate', 'bpm'], ['sleep_hours', 'Sleep', 'hours']]) {
    const b = baselines[key];
    if (!valid(current?.[key])) {
      insights.push(`${label} is missing today.`);
      continue;
    }
    const comparisons = [['week', '7-day', 7], ['month', '30-day', 30]].map(([window, title, total]) => {
      const { average, count } = b[window];
      return average === null ? `${title} average unavailable (insufficient data)` : `${title} average ${round(average)} ${unit}${count < total ? ` (partial: ${count} days)` : ''}`;
    });
    insights.push(`${label}: ${round(current[key])} ${unit}; ${comparisons.join('; ')}.`);
  }
  insights.push(...patterns(rows));
  const healthFlag = healthFlags(rows, today);
  const base = key => baselines[key].month.average ?? baselines[key].week.average;
  const largeChange = (valid(current?.hrv) && valid(base('hrv')) && current.hrv < base('hrv') * 0.7) || (valid(current?.resting_hr) && valid(base('resting_hr')) && current.resting_hr - base('resting_hr') >= Math.max(10, base('resting_hr') * 0.2)) || (valid(current?.recovery) && valid(base('recovery')) && current.recovery < base('recovery') - 25);
  const recoveryDeclining = trend(rows, today, 'recovery', 0.1) === 'down';
  if (recoveryDeclining) insights.push('Recovery has also been lower across recent days than your earlier personal baseline.');
  const fatigueTrend = recoveryDeclining || trends.hrv === 'down' || trends.resting_hr === 'up' || trends.sleep === 'declining';
  const recommendations = [];
  if (healthFlag) recommendations.push('Keep activity gentle today and discuss the flagged pattern with a doctor before hard training.');
  else if (!current || !valid(current.recovery)) recommendations.push('Sync your WHOOP and wait for today’s recovery to be scored before using this report to change training intensity.');
  else if (fatigueTrend || largeChange) recommendations.push('Choose easy movement or a rest day instead of a hard session today; reassess how you feel before adding intensity.');
  else if (Object.values(trends).some(v => v === null)) recommendations.push('There is not enough history to adjust intensity confidently; keep to familiar activity and how you feel.');
  else recommendations.push(profile.goal === 'recovery' ? 'Keep training comfortable today to support your recovery goal; there is no need to push harder based on a score alone.' : 'Stay with your planned training if you feel well; do not add intensity just because of today’s score.');
  const largeSleepLoss = valid(current?.sleep_hours) && valid(base('sleep_hours')) && current.sleep_hours < base('sleep_hours') - 2;
  if (trends.sleep === 'declining' || largeSleepLoss) recommendations.push('Move bedtime earlier tonight while keeping your usual wake time, leaving room for a full night of sleep.');
  else recommendations.push('Keep your usual bedtime and wake time tonight to make your sleep routine consistent.');
  const summary = !current || !valid(current.recovery)
    ? 'Today’s scored recovery is missing; older readings are not a substitute. Available history is shown without filling data gaps.'
    : `Today’s WHOOP recovery is ${round(current.recovery)}% (${status}). ${healthFlag ? 'A pattern in your readings deserves a check with a doctor.' : fatigueTrend || largeChange ? 'Your personal readings suggest taking a lighter approach today.' : Object.values(trends).some(v => v === null) ? 'More history is needed before drawing a reliable trend.' : 'Your recent readings do not show a clear reason to change your usual plan.'}`;
  return {
    date: today,
    latest_date: rows.at(-1)?.date ?? null,
    current,
    baselines,
    history: rows,
    analysis: { summary, recovery_status: status, key_insights: insights, recommendations: recommendations.slice(0, 3), trends, health_flag: healthFlag },
  };
}

export const analyze = (rows, today, profile) => buildReport(rows, today, profile).analysis;
