import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ensureGarmin, garminApi, isoDate } from './utils.js';
function noData(v) {
    return v == null || (typeof v === 'object' && v.status === 204);
}
// ── garmin hrv (heart-rate variability) ─────────────────────────────────
cli({
    site: 'garmin',
    name: 'hrv',
    access: 'read',
    description: 'Heart-rate variability summary for a night',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'last_night_avg', 'last_night_5min_high', 'weekly_avg', 'status', 'feedback'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const data = await garminApi(page, `/gc-api/hrv-service/hrv/${date}`);
        const s = !noData(data) && data.hrvSummary;
        if (!s)
            throw new EmptyResultError('garmin hrv', `No HRV data for ${date} (needs a compatible watch worn overnight).`);
        return [{
                date,
                last_night_avg: s.lastNightAvg != null ? s.lastNightAvg : '',
                last_night_5min_high: s.lastNight5MinHigh != null ? s.lastNight5MinHigh : '',
                weekly_avg: s.weeklyAvg != null ? s.weeklyAvg : '',
                status: s.status || '',
                feedback: s.feedbackPhrase || '',
            }];
    },
});
// ── garmin hydration (water intake) ─────────────────────────────────────
cli({
    site: 'garmin',
    name: 'hydration',
    access: 'read',
    description: 'Daily hydration — water intake vs goal, sweat loss',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'intake_ml', 'goal_ml', 'sweat_loss_ml', 'activity_intake_ml', 'unit'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const d = await garminApi(page, `/gc-api/usersummary-service/usersummary/hydration/allData/${date}`);
        if (noData(d) || (d.valueInML == null && d.goalInML == null))
            throw new EmptyResultError('garmin hydration', `No hydration data for ${date}.`);
        return [{
                date,
                intake_ml: d.valueInML != null ? Math.round(d.valueInML) : '',
                goal_ml: d.goalInML != null ? Math.round(d.goalInML) : '',
                sweat_loss_ml: d.sweatLossInML != null ? Math.round(d.sweatLossInML) : '',
                activity_intake_ml: d.activityIntakeInML != null ? Math.round(d.activityIntakeInML) : '',
                unit: d.hydrationMeasurementUnit || '',
            }];
    },
});
// ── garmin respiration (breaths per minute) ─────────────────────────────
cli({
    site: 'garmin',
    name: 'respiration',
    access: 'read',
    description: 'Daily respiration rate (breaths per minute)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'avg_waking', 'avg_sleep', 'highest', 'lowest'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const d = await garminApi(page, `/gc-api/wellness-service/wellness/daily/respiration/${date}`);
        if (noData(d) || (d.avgWakingRespirationValue == null && d.lowestRespirationValue == null))
            throw new EmptyResultError('garmin respiration', `No respiration data for ${date}.`);
        return [{
                date,
                avg_waking: d.avgWakingRespirationValue != null ? d.avgWakingRespirationValue : '',
                avg_sleep: d.avgSleepRespirationValue != null ? d.avgSleepRespirationValue : '',
                highest: d.highestRespirationValue != null ? d.highestRespirationValue : '',
                lowest: d.lowestRespirationValue != null ? d.lowestRespirationValue : '',
            }];
    },
});
// ── garmin spo2 (blood oxygen / pulse ox) ───────────────────────────────
cli({
    site: 'garmin',
    name: 'spo2',
    access: 'read',
    description: 'Daily blood-oxygen (pulse ox) summary',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'avg_spo2', 'lowest_spo2', 'latest_spo2', 'seven_day_avg'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const d = await garminApi(page, `/gc-api/wellness-service/wellness/daily/spo2/${date}`);
        if (noData(d) || (d.averageSpO2 == null && d.lowestSpO2 == null && d.latestSpO2 == null))
            throw new EmptyResultError('garmin spo2', `No blood-oxygen data for ${date} (needs a pulse-ox capable watch).`);
        return [{
                date,
                avg_spo2: d.averageSpO2 != null ? d.averageSpO2 : '',
                lowest_spo2: d.lowestSpO2 != null ? d.lowestSpO2 : '',
                latest_spo2: d.latestSpO2 != null ? d.latestSpO2 : '',
                seven_day_avg: d.lastSevenDaysAvgSpO2 != null ? d.lastSevenDaysAvgSpO2 : '',
            }];
    },
});
