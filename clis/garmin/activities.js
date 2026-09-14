import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GC, ensureGarmin, garminApi, metersToKm, normalizeActivityId, secondsToHms } from './utils.js';
// ── garmin activities ───────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'activities',
    access: 'read',
    description: 'Your recent Garmin Connect activities',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of activities' },
        { name: 'start', type: 'int', default: 0, help: 'Offset for paging' },
    ],
    columns: ['rank', 'activity_id', 'name', 'type', 'distance_km', 'duration', 'calories', 'avg_hr', 'date'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        const start = kwargs.start || 0;
        await ensureGarmin(page);
        const data = await garminApi(page, `/gc-api/activitylist-service/activities/search/activities?limit=${limit}&start=${start}`);
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin activities', 'No activities found.');
        return data.map((a, i) => ({
            rank: start + i + 1,
            activity_id: String(a.activityId),
            name: a.activityName || '',
            type: (a.activityType && a.activityType.typeKey) || '',
            distance_km: metersToKm(a.distance),
            duration: secondsToHms(a.duration),
            calories: a.calories != null ? Math.round(a.calories) : '',
            avg_hr: a.averageHR != null ? Math.round(a.averageHR) : '',
            date: a.startTimeLocal || '',
        }));
    },
});
// ── garmin activity ─────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'activity',
    access: 'read',
    description: 'A single Garmin Connect activity in detail',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
    ],
    columns: ['activity_id', 'name', 'type', 'distance_km', 'duration', 'calories', 'avg_hr', 'max_hr', 'elevation_gain', 'avg_speed', 'location', 'date'],
    func: async (page, kwargs) => {
        const id = normalizeActivityId(kwargs.id);
        if (!id)
            throw new EmptyResultError('garmin activity', `Could not parse an activity id from "${kwargs.id}".`);
        await ensureGarmin(page);
        const a = await garminApi(page, `/gc-api/activity-service/activity/${id}`);
        if (!a || !a.activityId)
            throw new EmptyResultError('garmin activity', `Activity ${id} not found.`);
        const s = a.summaryDTO || {};
        const avgSpeed = s.averageSpeed != null ? (Number(s.averageSpeed) * 3.6).toFixed(2) : '';
        return [{
                activity_id: String(a.activityId),
                name: a.activityName || '',
                type: (a.activityTypeDTO && a.activityTypeDTO.typeKey) || '',
                distance_km: metersToKm(s.distance),
                duration: secondsToHms(s.duration),
                calories: s.calories != null ? Math.round(s.calories) : '',
                avg_hr: s.averageHR != null ? Math.round(s.averageHR) : '',
                max_hr: s.maxHR != null ? Math.round(s.maxHR) : '',
                elevation_gain: s.elevationGain != null ? `${Math.round(s.elevationGain)} m` : '',
                avg_speed: avgSpeed ? `${avgSpeed} km/h` : '',
                location: a.locationName || '',
                date: s.startTimeLocal || '',
            }];
    },
});
