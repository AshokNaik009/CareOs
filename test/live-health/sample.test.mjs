import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleData } from '../../lib/live-health/sample.mjs';
import { dateInZone, normalize } from '../../lib/live-health/normalize.mjs';
import { buildReport } from '../../lib/live-health/analysis.mjs';

for (const [time, timeZone] of [
  ['2026-09-25T00:05:00Z', 'UTC'],
  ['2026-09-24T20:05:00Z', 'Asia/Dubai'],
  ['2026-09-25T07:05:00Z', 'America/Los_Angeles'],
  ['2026-09-24T18:35:00Z', 'Asia/Kolkata'],
  ['2026-11-02T05:05:00Z', 'America/New_York'],
  ['2026-09-25T12:00:00Z', 'Pacific/Kiritimati'],
]) {
  test(`mock cards and averages stay populated at ${time} in ${timeZone}`, () => {
    const now = Date.parse(time);
    const data = createSampleData(now);
    const report = buildReport(normalize(data, timeZone), dateInZone(now, timeZone));
    assert.ok(report.current, 'Mock data must include the viewer’s current local day');
    for (const metric of ['hrv', 'resting_hr', 'sleep_hours', 'strain']) {
      assert.ok(Number.isFinite(report.current[metric]), `${metric} current reading`);
      assert.ok(Number.isFinite(report.baselines[metric].week.average), `${metric} seven-day average`);
      assert.ok(Number.isFinite(report.baselines[metric].month.average), `${metric} thirty-day average`);
    }
    assert.equal(Object.hasOwn(data, 'live_bpm'), false);
  });
}
