export function dateInZone(value, timeZone) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

const number = (value, min = 0, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const score = record => record?.score_state === 'SCORED' ? record.score ?? {} : {};
const hours = value => number(value) === null ? null : value / 3600000;
const latest = records => [...new Map([...records].sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? '')).map(r => [r.id ?? r.cycle_id, r])).values()];

export function normalize({ cycles = [], recoveries = [], sleeps = [], workouts = [] }, timeZone) {
  const days = new Map();
  const getDay = date => {
    if (!days.has(date)) days.set(date, { date, recovery: null, hrv: null, resting_hr: null, spo2: null, skin_temp: null, sleep_hours: null, sleep_performance: null, sleep_efficiency: null, respiratory_rate: null, strain: null, kilojoule: null, average_hr: null, stages: null, workouts: [] });
    return days.get(date);
  };
  const recoveryBySleep = new Map(latest(recoveries).map(r => [r.sleep_id, r]));
  for (const cycle of latest(cycles).sort((a, b) => a.start.localeCompare(b.start))) {
    const date = dateInZone(cycle.start, timeZone);
    if (!date) continue;
    const s = score(cycle);
    Object.assign(getDay(date), { strain: number(s.strain, 0, 21), kilojoule: number(s.kilojoule), average_hr: number(s.average_heart_rate), cycle_open: !cycle.end });
  }
  for (const sleep of latest(sleeps).filter(s => s.nap === false).sort((a, b) => (a.end ?? '').localeCompare(b.end ?? ''))) {
    const date = dateInZone(sleep.end, timeZone);
    if (!date) continue;
    const s = score(sleep);
    const stages = s.stage_summary ?? {};
    const parts = {
      light: hours(stages.total_light_sleep_time_milli),
      deep: hours(stages.total_slow_wave_sleep_time_milli),
      rem: hours(stages.total_rem_sleep_time_milli),
      awake: hours(stages.total_awake_time_milli),
    };
    const asleep = [parts.light, parts.deep, parts.rem];
    const r = score(recoveryBySleep.get(sleep.id));
    const recovery = r.user_calibrating ? {} : r;
    Object.assign(getDay(date), {
      sleep_hours: asleep.every(v => v !== null) ? asleep.reduce((a, b) => a + b, 0) : null,
      sleep_performance: number(s.sleep_performance_percentage, 0, 100),
      sleep_efficiency: number(s.sleep_efficiency_percentage, 0, 100),
      respiratory_rate: number(s.respiratory_rate),
      stages: parts,
      recovery: number(recovery.recovery_score, 0, 100),
      hrv: number(recovery.hrv_rmssd_milli),
      resting_hr: number(recovery.resting_heart_rate),
      spo2: number(recovery.spo2_percentage, 0, 100),
      skin_temp: number(recovery.skin_temp_celsius, -100, 100),
    });
  }
  for (const workout of latest(workouts)) {
    const date = dateInZone(workout.start, timeZone);
    if (!date) continue;
    const s = score(workout);
    const duration = new Date(workout.end).getTime() - new Date(workout.start).getTime();
    getDay(date).workouts.push({ id: workout.id, sport: workout.sport_name || 'Workout', strain: number(s.strain, 0, 21), duration_minutes: number(duration) === null ? null : duration / 60000, zones: Object.fromEntries(['zero', 'one', 'two', 'three', 'four', 'five'].map((name, zone) => [zone, hours(s.zone_durations?.[`zone_${name}_milli`])])) });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
