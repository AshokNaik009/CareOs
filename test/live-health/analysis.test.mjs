import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, buildReport, shiftDate } from '../../lib/live-health/analysis.mjs';
import { normalize } from '../../lib/live-health/normalize.mjs';

const today = '2026-09-25';
const day = (date, values = {}) => ({ date, recovery: 75, hrv: 60, resting_hr: 55, sleep_hours: 8, sleep_performance: 95, respiratory_rate: 15, spo2: 97, strain: 10, ...values });
const history = () => Array.from({ length: 31 }, (_, i) => day(shiftDate(today, i - 30)));

test('empty data returns unknowns, not reassuring colors or stable trends', () => {
  const result = analyze([], today);
  assert.equal(result.recovery_status, null);
  assert.deepEqual(result.trends, { hrv: null, resting_hr: null, sleep: null });
  assert.match(result.summary, /missing/i);
  assert.equal(result.health_flag, null);
  assert.ok(result.recommendations.length >= 1 && result.recommendations.length <= 3);
});

test('baselines exclude today and future records and retain sample counts', () => {
  const rows = history();
  rows.at(-1).hrv = 120;
  rows.push(day(shiftDate(today, 1), { hrv: 1000 }));
  const report = buildReport(rows, today);
  assert.equal(report.baselines.hrv.week.average, 60);
  assert.equal(report.baselines.hrv.month.average, 60);
  assert.equal(report.baselines.hrv.week.count, 7);
  assert.equal(report.baselines.hrv.month.count, 30);
});

test('missing days do not become zeroes or complete baselines', () => {
  const report = buildReport([day(today), day(shiftDate(today, -1))], today);
  assert.equal(report.baselines.hrv.week.average, null);
  assert.equal(report.baselines.hrv.week.count, 1);
  assert.equal(report.analysis.trends.hrv, null);
});

test('partial baselines explicitly retain coverage', () => {
  const report = buildReport(history().slice(-6), today);
  assert.equal(report.baselines.hrv.week.average, 60);
  assert.equal(report.baselines.hrv.week.count, 5);
  assert.match(report.analysis.key_insights.join(' '), /partial/i);
});

test('one modest change does not become a multi-day trend', () => {
  const rows = history();
  rows.at(-1).hrv = 55;
  const result = analyze(rows, today);
  assert.equal(result.trends.hrv, 'stable');
  assert.doesNotMatch(result.recommendations.join(' '), /easy movement/i);
});

test('one moderately short night is not described as a sustained sleep decline', () => {
  const rows = history();
  rows.at(-1).sleep_hours = 6.5;
  const result = analyze(rows, today);
  assert.equal(result.trends.sleep, 'stable');
  assert.doesNotMatch(result.recommendations.join(' '), /easy movement/i);
});

test('sustained recovery decline changes advice even with stable HRV', () => {
  const rows = history();
  rows.slice(-3).forEach(d => { d.recovery = 55; });
  assert.match(analyze(rows, today).recommendations.join(' '), /easy movement/i);
});

test('sustained lower HRV and sleep produce conservative advice', () => {
  const rows = history();
  rows.slice(-3).forEach(d => { d.hrv = 40; d.sleep_hours = 6; });
  const result = analyze(rows, today);
  assert.equal(result.trends.hrv, 'down');
  assert.equal(result.trends.sleep, 'declining');
  assert.match(result.recommendations.join(' '), /easy movement/i);
  assert.match(result.recommendations.join(' '), /bedtime/i);
});

test('stale recovery is not presented as today', () => {
  const result = analyze(history().slice(0, -1), today);
  assert.equal(result.recovery_status, null);
  assert.match(result.summary, /missing/i);
  assert.equal(result.trends.hrv, null);
});

test('repeated low oxygen triggers a gentle doctor flag', () => {
  const rows = history();
  rows.at(-1).spo2 = 91;
  rows.at(-3).spo2 = 90;
  assert.match(analyze(rows, today).health_flag, /doctor/i);
  rows.at(-3).spo2 = 97;
  assert.equal(analyze(rows, today).health_flag, null);
});

test('three consecutive sharp resting HR increases trigger a flag', () => {
  const rows = history();
  rows.slice(-4).forEach((d, i) => { d.resting_hr = 55 + i * 4; });
  assert.match(analyze(rows, today).health_flag, /resting heart rate/i);
  rows.splice(-2, 1);
  assert.equal(analyze(rows, today).health_flag, null);
});

test('sustained high breathing rate compares with an earlier personal baseline', () => {
  const rows = history();
  rows.slice(-3).forEach(d => { d.respiratory_rate = 19; });
  assert.match(analyze(rows, today).health_flag, /breathing rate/i);
  assert.equal(analyze([day(today, { respiratory_rate: 19 })], today).health_flag, null);
});

test('a large single-day deviation can change the advice', () => {
  const rows = history();
  rows.at(-1).hrv = 25;
  assert.match(analyze(rows, today).recommendations.join(' '), /easy movement/i);
});

test('high-strain patterns require repeated next-day pairs, not a single event', () => {
  const rows = history();
  rows.at(-6).strain = 18;
  rows.at(-5).recovery = 40;
  rows.at(-3).strain = 18;
  rows.at(-2).recovery = 40;
  assert.match(analyze(rows, today).key_insights.join(' '), /higher-strain days/i);
  rows.at(-2).recovery = 75;
  assert.doesNotMatch(analyze(rows, today).key_insights.join(' '), /higher-strain days/i);
});

test('shorter sleep and lower HRV are described as association, not causation', () => {
  const rows = history();
  [10, 15, 20].forEach(i => { rows[i].sleep_hours = 6; rows[i].hrv = 40; });
  assert.match(analyze(rows, today).key_insights.join(' '), /coincided/);
});

test('WHOOP recovery bands preserve boundary and zero values', () => {
  for (const [score, status] of [[0, 'red'], [33, 'red'], [34, 'yellow'], [66, 'yellow'], [67, 'green'], [100, 'green']]) {
    assert.equal(analyze([day(today, { recovery: score })], today).recovery_status, status);
  }
});

test('analysis JSON has precisely the requested keys', () => {
  assert.deepEqual(Object.keys(analyze(history(), today)).sort(), ['summary', 'recovery_status', 'key_insights', 'recommendations', 'trends', 'health_flag'].sort());
});

const rawSleep = { id: 'sleep-1', cycle_id: 1, start: '2026-09-24T23:00:00Z', end: '2026-09-25T07:00:00Z', nap: false, score_state: 'SCORED', score: { stage_summary: { total_light_sleep_time_milli: 14400000, total_slow_wave_sleep_time_milli: 7200000, total_rem_sleep_time_milli: 3600000, total_awake_time_milli: 3600000 }, respiratory_rate: 15 } };
const rawRecovery = { cycle_id: 1, sleep_id: 'sleep-1', score_state: 'SCORED', score: { recovery_score: 75, hrv_rmssd_milli: 60, resting_heart_rate: 55, user_calibrating: false } };

test('normalization joins by sleep ID and excludes awake time from sleep hours', () => {
  const rows = normalize({ sleeps: [rawSleep], recoveries: [rawRecovery], cycles: [], workouts: [] }, 'UTC');
  assert.equal(rows[0].date, today);
  assert.equal(rows[0].sleep_hours, 7);
  assert.equal(rows[0].recovery, 75);
  assert.equal(rows[0].stages.awake, 1);
});

test('naps and unscored or calibrating recovery do not contaminate analysis', () => {
  const rows = normalize({ sleeps: [rawSleep, { ...rawSleep, id: 'nap', nap: true }], recoveries: [{ ...rawRecovery, score: { ...rawRecovery.score, user_calibrating: true } }], cycles: [], workouts: [] }, 'UTC');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recovery, null);
  assert.equal(rows[0].hrv, null);
});

test('missing sleep stages remain missing; invalid scores are not coerced', () => {
  const rows = normalize({ sleeps: [{ ...rawSleep, score: {} }], recoveries: [{ ...rawRecovery, score: { recovery_score: '75', hrv_rmssd_milli: -10 } }], cycles: [], workouts: [] }, 'UTC');
  assert.equal(rows[0].sleep_hours, null);
  assert.equal(rows[0].recovery, null);
  assert.equal(rows[0].hrv, null);
});

test('timezone affects wake date rather than server-local or creation date', () => {
  const rows = normalize({ sleeps: [{ ...rawSleep, end: '2026-09-25T02:00:00Z' }], recoveries: [rawRecovery], cycles: [], workouts: [] }, 'America/Los_Angeles');
  assert.equal(rows[0].date, '2026-09-24');
});

test('duplicate records do not double-count days', () => {
  const rows = normalize({ sleeps: [rawSleep, rawSleep], recoveries: [rawRecovery, rawRecovery], cycles: [], workouts: [] }, 'UTC');
  assert.equal(rows.length, 1);
});

test('WHOOP v2 workout zone names and duration units are normalized exactly', () => {
  const workout = { id: 'workout-1', sport_name: 'running', start: '2026-09-25T10:00:00Z', end: '2026-09-25T11:00:00Z', score_state: 'SCORED', score: { strain: 12, zone_durations: { zone_zero_milli: 0, zone_one_milli: 1800000, zone_two_milli: 1800000 } } };
  const rows = normalize({ workouts: [workout, workout] }, 'UTC');
  assert.equal(rows[0].workouts.length, 1);
  assert.equal(rows[0].workouts[0].duration_minutes, 60);
  assert.deepEqual(rows[0].workouts[0].zones, { 0: 0, 1: 0.5, 2: 0.5, 3: null, 4: null, 5: null });
});
