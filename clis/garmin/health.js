import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ensureGarmin, garminApi, getProfile, isoDate, metersToKm, secondsToHms } from './utils.js';
function startDateFromDays(days) {
    const sd = new Date(Date.now() - (days || 30) * 86400000);
    return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
}
// ── garmin stats (daily summary) ────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'stats',
    access: 'read',
    description: 'Daily wellness summary (steps, calories, distance, floors)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'steps', 'step_goal', 'total_calories', 'active_calories', 'distance_km', 'floors', 'intensity_min'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const d = await garminApi(page, `/gc-api/usersummary-service/usersummary/daily/${sp.displayName}?calendarDate=${date}`);
        if (!d || typeof d !== 'object')
            throw new EmptyResultError('garmin stats', `No wellness summary for ${date}.`);
        const intensity = (d.moderateIntensityMinutes || 0) + (d.vigorousIntensityMinutes || 0);
        return [{
                date,
                steps: d.totalSteps != null ? d.totalSteps : '',
                step_goal: d.dailyStepGoal != null ? d.dailyStepGoal : '',
                total_calories: d.totalKilocalories != null ? Math.round(d.totalKilocalories) : '',
                active_calories: d.activeKilocalories != null ? Math.round(d.activeKilocalories) : '',
                distance_km: metersToKm(d.totalDistanceMeters),
                floors: d.floorsAscended != null ? d.floorsAscended : '',
                intensity_min: intensity || '',
            }];
    },
});
// ── garmin sleep ────────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'sleep',
    access: 'read',
    description: 'Sleep breakdown for a night (deep / light / rem / awake)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'total_sleep', 'deep', 'light', 'rem', 'awake'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const resp = await garminApi(page, `/gc-api/wellness-service/wellness/dailySleepData/${sp.displayName}?date=${date}&nonSleepBufferMinutes=60`);
        const s = resp && resp.dailySleepDTO;
        if (!s || s.sleepTimeSeconds == null)
            throw new EmptyResultError('garmin sleep', `No sleep data for ${date}.`);
        return [{
                date,
                total_sleep: secondsToHms(s.sleepTimeSeconds),
                deep: secondsToHms(s.deepSleepSeconds),
                light: secondsToHms(s.lightSleepSeconds),
                rem: secondsToHms(s.remSleepSeconds),
                awake: secondsToHms(s.awakeSleepSeconds),
            }];
    },
});
// ── garmin heartrate ────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'heartrate',
    access: 'read',
    description: 'Daily heart-rate summary (resting / max / min)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'resting_hr', 'max_hr', 'min_hr', 'seven_day_avg_resting'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const d = await garminApi(page, `/gc-api/wellness-service/wellness/dailyHeartRate/${sp.displayName}?date=${date}`);
        if (!d || (d.restingHeartRate == null && d.maxHeartRate == null))
            throw new EmptyResultError('garmin heartrate', `No heart-rate data for ${date}.`);
        return [{
                date,
                resting_hr: d.restingHeartRate != null ? d.restingHeartRate : '',
                max_hr: d.maxHeartRate != null ? d.maxHeartRate : '',
                min_hr: d.minHeartRate != null ? d.minHeartRate : '',
                seven_day_avg_resting: d.lastSevenDaysAvgRestingHeartRate != null ? d.lastSevenDaysAvgRestingHeartRate : '',
            }];
    },
});
// ── garmin bodybattery ──────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'bodybattery',
    access: 'read',
    description: 'Body Battery energy for a day (charged / drained / current)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'charged', 'drained', 'current'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const data = await garminApi(page, `/gc-api/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`);
        const day = Array.isArray(data) ? data[0] : null;
        const values = (day && day.bodyBatteryValuesArray) || [];
        const levels = values.map((v) => (Array.isArray(v) ? v[v.length - 1] : null)).filter((n) => n != null);
        if (!day || (day.charged == null && levels.length === 0))
            throw new EmptyResultError('garmin bodybattery', `No Body Battery data for ${date}.`);
        return [{
                date,
                charged: day.charged != null ? day.charged : '',
                drained: day.drained != null ? day.drained : '',
                current: levels.length ? levels[levels.length - 1] : '',
            }];
    },
});
// ── garmin stress ───────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'stress',
    access: 'read',
    description: 'Daily stress level (average / max)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'avg_stress', 'max_stress'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const d = await garminApi(page, `/gc-api/wellness-service/wellness/dailyStress/${date}`);
        // Garmin reports -1 / -2 when there is no measured stress for the day.
        if (!d || d.avgStressLevel == null || d.avgStressLevel < 0)
            throw new EmptyResultError('garmin stress', `No stress data for ${date}.`);
        return [{
                date,
                avg_stress: d.avgStressLevel,
                max_stress: d.maxStressLevel != null && d.maxStressLevel >= 0 ? d.maxStressLevel : '',
            }];
    },
});
// ── garmin weight ───────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'weight',
    access: 'read',
    description: 'Body weight log over the last N days',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'days', type: 'int', default: 90, help: 'Look back this many days' },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows' },
    ],
    columns: ['rank', 'date', 'weight_kg', 'bmi'],
    func: async (page, kwargs) => {
        const days = kwargs.days || 90;
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const data = await garminApi(page, `/gc-api/weight-service/weight/dateRange?startDate=${startDateFromDays(days)}&endDate=${isoDate()}`);
        const list = (data && data.dateWeightList) || [];
        if (!list.length)
            throw new EmptyResultError('garmin weight', 'No weight entries logged.');
        return list.slice(0, limit).map((w, i) => ({
            rank: i + 1,
            date: w.calendarDate || '',
            weight_kg: w.weight != null ? (Number(w.weight) / 1000).toFixed(1) : '',
            bmi: w.bmi != null ? Number(w.bmi).toFixed(1) : '',
        }));
    },
});
