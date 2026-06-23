import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ensureGarmin, garminApi, getProfile, isoDate, metersToKm, secondsToHms } from './utils.js';
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
