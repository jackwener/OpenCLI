import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ensureGarmin, garminApi, isoDate } from './utils.js';
function firstValue(map) {
    if (!map || typeof map !== 'object')
        return null;
    const vals = Object.values(map);
    return vals.length ? vals[0] : null;
}
function durationLabel(sec) {
    const s = Number(sec);
    if (!Number.isFinite(s))
        return '';
    if (s < 60)
        return `${s}s`;
    if (s < 3600)
        return `${Math.round(s / 60)}min`;
    return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)}h`;
}
// ── garmin status (training status + VO2 max) ───────────────────────────
cli({
    site: 'garmin',
    name: 'status',
    access: 'read',
    description: 'Training status, fitness trend and VO2 max',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'training_status', 'feedback', 'fitness_trend', 'sport', 'vo2max_running', 'vo2max_cycling'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const ts = await garminApi(page, `/gc-api/metrics-service/metrics/trainingstatus/aggregated/${date}`);
        const d = firstValue(ts && ts.mostRecentTrainingStatus && ts.mostRecentTrainingStatus.latestTrainingStatusData);
        const vo2 = ts && ts.mostRecentVO2Max;
        if (!d && !vo2)
            throw new EmptyResultError('garmin status', `No training status for ${date}.`);
        return [{
                date,
                training_status: d && d.trainingStatus != null ? d.trainingStatus : '',
                feedback: (d && d.trainingStatusFeedbackPhrase) || '',
                fitness_trend: d && d.fitnessTrend != null ? d.fitnessTrend : '',
                sport: (d && d.sport) || '',
                vo2max_running: vo2 && vo2.generic && vo2.generic.vo2MaxValue != null ? vo2.generic.vo2MaxValue : '',
                vo2max_cycling: vo2 && vo2.cycling && vo2.cycling.vo2MaxValue != null ? vo2.cycling.vo2MaxValue : '',
            }];
    },
});
// ── garmin load (acute / chronic training load) ─────────────────────────
cli({
    site: 'garmin',
    name: 'load',
    access: 'read',
    description: 'Training load: acute (short-term), chronic and load focus',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'date', type: 'str', help: 'Date YYYY-MM-DD (default: today)' },
    ],
    columns: ['date', 'acute_load', 'chronic_load', 'acwr_ratio', 'acwr_status', 'focus', 'aerobic_low', 'aerobic_high', 'anaerobic'],
    func: async (page, kwargs) => {
        const date = isoDate(kwargs.date);
        await ensureGarmin(page);
        const ts = await garminApi(page, `/gc-api/metrics-service/metrics/trainingstatus/aggregated/${date}`);
        const d = firstValue(ts && ts.mostRecentTrainingStatus && ts.mostRecentTrainingStatus.latestTrainingStatusData);
        const acute = d && d.acuteTrainingLoadDTO;
        const lb = firstValue(ts && ts.mostRecentTrainingLoadBalance && ts.mostRecentTrainingLoadBalance.metricsTrainingLoadBalanceDTOMap);
        if (!acute && !lb)
            throw new EmptyResultError('garmin load', `No training load for ${date}.`);
        const round = (v) => (v != null ? Math.round(v) : '');
        return [{
                date,
                acute_load: acute ? round(acute.dailyTrainingLoadAcute) : '',
                chronic_load: acute ? round(acute.dailyTrainingLoadChronic) : '',
                acwr_ratio: acute && acute.dailyAcuteChronicWorkloadRatio != null ? Number(acute.dailyAcuteChronicWorkloadRatio).toFixed(2) : '',
                acwr_status: (acute && acute.acwrStatus) || '',
                focus: (lb && lb.trainingBalanceFeedbackPhrase) || '',
                aerobic_low: lb ? round(lb.monthlyLoadAerobicLow) : '',
                aerobic_high: lb ? round(lb.monthlyLoadAerobicHigh) : '',
                anaerobic: lb ? round(lb.monthlyLoadAnaerobic) : '',
            }];
    },
});
// ── garmin powercurve (cycling power curve / FTP curve) ──────────────────
cli({
    site: 'garmin',
    name: 'powercurve',
    access: 'read',
    description: 'Cycling power curve — best power held for each duration',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'days', type: 'int', default: 365, help: 'Look back this many days' },
    ],
    columns: ['rank', 'duration', 'duration_sec', 'power_w', 'activity_date'],
    func: async (page, kwargs) => {
        const days = kwargs.days || 365;
        await ensureGarmin(page);
        const end = isoDate();
        const startMs = Date.now() - days * 86400000;
        const sd = new Date(startMs);
        const start = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
        const pc = await garminApi(page, `/gc-api/fitnessstats-service/powerCurve?startDate=${start}&endDate=${end}&aggregation=weekly`);
        const entries = pc && pc.entries ? Object.values(pc.entries) : [];
        if (!entries.length)
            throw new EmptyResultError('garmin powercurve', 'No power-curve data (no cycling power recorded).');
        entries.sort((a, b) => (a.duration || 0) - (b.duration || 0));
        return entries.map((e, i) => ({
            rank: i + 1,
            duration: durationLabel(e.duration),
            duration_sec: e.duration != null ? e.duration : '',
            power_w: e.power != null ? Math.round(e.power) : '',
            activity_date: e.activityDate || '',
        }));
    },
});
