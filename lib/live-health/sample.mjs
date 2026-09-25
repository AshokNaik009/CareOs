// Opt-in sample mode (LIVE_HEALTH_SAMPLE_DATA=true). Produces WHOOP-shaped records so the normal
// normalize/analysis pipeline runs unchanged. Sample sessions never reach alerts or calls.
const DAY = 86400000;
const HOUR = 3600000;

function random(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

export function createSampleData(now = Date.now()) {
  const next = random(20260925);
  const cycles = [], recoveries = [], sleeps = [], workouts = [];
  const sports = ['Running', 'Cycling', 'Functional Fitness', 'Walking'];
  for (let i = 30; i >= 0; i--) {
    const wake = now - i * DAY - HOUR;
    const asleepStart = wake - 8 * HOUR;
    const dip = i <= 2 ? 1 : 0; // the last few days trend down so the brief has something to explain
    const sleepHours = 7.4 - dip * 0.9 + (next() - 0.5) * 1.2;
    const sleepId = `sample-sleep-${i}`;
    const cycleId = 1000 + (30 - i);
    const updated = new Date(wake + 5 * 60000).toISOString();
    sleeps.push({
      id: sleepId, start: new Date(asleepStart).toISOString(), end: new Date(wake).toISOString(), nap: false, updated_at: updated, score_state: 'SCORED',
      score: {
        stage_summary: { total_light_sleep_time_milli: sleepHours * 0.52 * HOUR, total_slow_wave_sleep_time_milli: sleepHours * 0.22 * HOUR, total_rem_sleep_time_milli: sleepHours * 0.26 * HOUR, total_awake_time_milli: (0.4 + next() * 0.4) * HOUR },
        sleep_performance_percentage: Math.round(Math.min(100, sleepHours / 8 * 100)),
        sleep_efficiency_percentage: Math.round(88 + next() * 8),
        respiratory_rate: round(14.6 + (next() - 0.5) * 0.8),
      },
    });
    recoveries.push({
      cycle_id: cycleId, sleep_id: sleepId, updated_at: updated, score_state: 'SCORED',
      score: {
        user_calibrating: false,
        recovery_score: Math.round(Math.max(20, Math.min(96, 68 - dip * 24 + (next() - 0.5) * 24))),
        resting_heart_rate: Math.round(56 + dip * 4 + (next() - 0.5) * 4),
        hrv_rmssd_milli: round(62 - dip * 12 + (next() - 0.5) * 12, 3),
        spo2_percentage: round(96 + next() * 2.5),
        skin_temp_celsius: round(33.6 + (next() - 0.5) * 0.6, 2),
      },
    });
    cycles.push({
      id: cycleId, start: new Date(wake).toISOString(), end: i === 0 ? null : new Date(wake + DAY).toISOString(), updated_at: updated, score_state: 'SCORED',
      score: { strain: round(8 + next() * 8), kilojoule: Math.round(8500 + next() * 3500), average_heart_rate: Math.round(68 + next() * 10) },
    });
    if (i > 0 && i % 2 === 0) {
      const start = wake + 10 * HOUR;
      const minutes = 35 + Math.round(next() * 40);
      const zone = share => share * minutes * 60000;
      workouts.push({
        id: `sample-workout-${i}`, start: new Date(start).toISOString(), end: new Date(start + minutes * 60000).toISOString(), sport_name: sports[i % sports.length], updated_at: updated, score_state: 'SCORED',
        score: { strain: round(9 + next() * 6), zone_durations: { zone_zero_milli: zone(0.05), zone_one_milli: zone(0.2), zone_two_milli: zone(0.35), zone_three_milli: zone(0.25), zone_four_milli: zone(0.12), zone_five_milli: zone(0.03) } },
      });
    }
  }
  return { cycles, recoveries, sleeps, workouts, fetchedAt: new Date(now).toISOString() };
}
