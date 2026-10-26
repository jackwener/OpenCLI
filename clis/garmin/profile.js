import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ensureGarmin, garminApi, getProfile } from './utils.js';
// ── garmin prs (personal records) ───────────────────────────────────────
cli({
    site: 'garmin',
    name: 'prs',
    access: 'read',
    description: 'Your Garmin Connect personal records',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of records' },
    ],
    columns: ['rank', 'type_id', 'activity_type', 'value', 'activity_name', 'activity_id', 'date'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/personalrecord-service/personalrecord/prs/${sp.displayName}`);
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin prs', 'No personal records found.');
        return data.slice(0, limit).map((p, i) => ({
            rank: i + 1,
            type_id: p.typeId != null ? String(p.typeId) : '',
            activity_type: p.activityType || '',
            value: p.value != null ? p.value : '',
            activity_name: p.activityName || '',
            activity_id: p.activityId ? String(p.activityId) : '',
            date: p.prStartTimeLocalFormatted || p.activityStartDateTimeLocalFormatted || '',
        }));
    },
});
// ── garmin gear ─────────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'gear',
    access: 'read',
    description: 'Your registered Garmin gear (shoes, bikes, …)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['name', 'make', 'model', 'type', 'status'],
    func: async (page) => {
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/gear-service/gear/filterGear?activityType=&userProfilePk=${sp.profileId}`);
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin gear', 'No gear registered.');
        return data.map((g) => ({
            name: g.displayName || [g.gearMakeName, g.gearModelName].filter(Boolean).join(' ') || '',
            make: g.gearMakeName || '',
            model: g.gearModelName || '',
            type: g.gearTypeName || '',
            status: g.gearStatusName || '',
        }));
    },
});
// ── garmin devices ──────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'devices',
    access: 'read',
    description: 'Your registered Garmin devices',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['name', 'part_number', 'application_key'],
    func: async (page) => {
        await ensureGarmin(page);
        const data = await garminApi(page, '/gc-api/device-service/deviceregistration/devices');
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin devices', 'No registered devices found.');
        return data.map((d) => ({
            name: d.productDisplayName || d.displayName || '',
            part_number: d.partNumber || '',
            application_key: d.applicationKey || '',
        }));
    },
});
// ── garmin badges ───────────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'badges',
    access: 'read',
    description: 'Badges you have earned',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of badges' },
    ],
    columns: ['rank', 'name', 'points', 'category_id', 'earned_date'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const data = await garminApi(page, '/gc-api/badge-service/badge/earned');
        if (!Array.isArray(data) || data.length === 0)
            throw new EmptyResultError('garmin badges', 'No earned badges found.');
        return data.slice(0, limit).map((b, i) => ({
            rank: i + 1,
            name: b.badgeName || '',
            points: b.badgePoints != null ? b.badgePoints : '',
            category_id: b.badgeCategoryId != null ? String(b.badgeCategoryId) : '',
            earned_date: b.badgeEarnedDate || b.badgeAwardedDate || '',
        }));
    },
});
// ── garmin connections ──────────────────────────────────────────────────
cli({
    site: 'garmin',
    name: 'connections',
    access: 'read',
    description: 'Your Garmin Connect connections (friends)',
    domain: 'connect.garmin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of connections' },
    ],
    columns: ['rank', 'name', 'display_name', 'location'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        await ensureGarmin(page);
        const sp = await getProfile(page);
        const data = await garminApi(page, `/gc-api/connection-service/connection/v2/connections/pagination/${sp.displayName}?start=0&limit=${limit}`);
        const list = (data && data.userConnections) || [];
        if (!list.length)
            throw new EmptyResultError('garmin connections', 'No connections found.');
        return list.map((c, i) => ({
            rank: i + 1,
            name: c.fullName || '',
            display_name: c.displayName || '',
            location: c.location || '',
        }));
    },
});
