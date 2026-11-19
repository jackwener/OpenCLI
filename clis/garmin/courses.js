import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GC, ensureGarmin, garminApi, getProfile, metersToKm } from './utils.js';
function courseTypeKey(t) {
    if (!t)
        return '';
    if (typeof t === 'string')
        return t;
    return t.typeKey || '';
}
// ── garmin courses (saved routes / 路书) ─────────────────────────────────
cli({
    site: 'garmin',
    name: 'courses',
    access: 'read',
    description: 'Your saved Garmin courses / routes (路书)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of courses' },
    ],
    columns: ['rank', 'course_id', 'name', 'type', 'distance_km', 'elevation_gain', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/course-service/course/owner/${sp.displayName}?start=0&limit=${limit}`);
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin courses', 'No saved courses found.');
        return data.map((c, i) => ({
            rank: i + 1,
            course_id: String(c.courseId),
            name: c.courseName || '',
            type: courseTypeKey(c.activityType),
            distance_km: metersToKm(c.distanceInMeters != null ? c.distanceInMeters : c.distance),
            elevation_gain: c.elevationGainInMeters != null ? `${Math.round(c.elevationGainInMeters)} m` : '',
            url: `${GC}/modern/course/${c.courseId}`,
        }));
    },
});
// ── garmin course (route detail) ────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'course',
    access: 'read',
    description: 'A single Garmin course / route in detail',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', type: 'str', positional: true, required: true, help: 'Course ID or course URL' },
    ],
    columns: ['course_id', 'name', 'distance_km', 'elevation_gain', 'elevation_loss', 'description', 'geo_route_pk', 'url'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id).match(/(\d+)/)?.[1] || '';
        if (!id)
            throw new EmptyResultError('garmin course', `Could not parse a course id from "${kwargs.id}".`);
        await ensureGarmin(page);
        const c = await garminApi(page, `/gc-api/course-service/course/${id}`);
        if (!c || !c.courseId)
            throw new EmptyResultError('garmin course', `Course ${id} not found.`);
        return [{
                course_id: String(c.courseId),
                name: c.courseName || '',
                distance_km: metersToKm(c.distanceMeter),
                elevation_gain: c.elevationGainMeter != null ? `${Math.round(c.elevationGainMeter)} m` : '',
                elevation_loss: c.elevationLossMeter != null ? `${Math.round(c.elevationLossMeter)} m` : '',
                description: (c.description || '').slice(0, 200),
                geo_route_pk: c.geoRoutePk != null ? String(c.geoRoutePk) : '',
                url: `${GC}/modern/course/${c.courseId}`,
            }];
    },
});
