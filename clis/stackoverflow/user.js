// stackoverflow user — search Stack Overflow users by name and return profiles.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    seFetch,
    normalizeLimit,
    requireString,
    epochToDate,
    ensureItems,
    decodeHtmlEntities,
} from './utils.js';

cli({
    site: 'stackoverflow',
    name: 'user',
    access: 'read',
    description: 'Find Stack Overflow users by display name (highest reputation first).',
    domain: 'stackoverflow.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, type: 'string', help: 'Display name (or substring) to search.' },
        { name: 'limit', type: 'int', default: 10, help: 'Max users to return (max 100).' },
    ],
    columns: ['userId', 'displayName', 'reputation', 'goldBadges', 'silverBadges', 'bronzeBadges', 'location', 'createdAt', 'lastAccessAt', 'url'],
    func: async (args) => {
        const name = requireString(args.name, 'name');
        const limit = normalizeLimit(args.limit, 10, 100, 'limit');
        const data = await seFetch('/users', {
            searchParams: {
                inname: name,
                order: 'desc',
                sort: 'reputation',
                pagesize: limit,
            },
        });
        const items = ensureItems(data, 'stackoverflow user');
        return items.slice(0, limit).map((u) => ({
            userId: u.user_id,
            displayName: decodeHtmlEntities(u.display_name || ''),
            reputation: u.reputation ?? 0,
            goldBadges: u.badge_counts?.gold ?? 0,
            silverBadges: u.badge_counts?.silver ?? 0,
            bronzeBadges: u.badge_counts?.bronze ?? 0,
            location: decodeHtmlEntities(u.location || ''),
            createdAt: epochToDate(u.creation_date),
            lastAccessAt: epochToDate(u.last_access_date),
            url: u.link || (u.user_id ? `https://stackoverflow.com/users/${u.user_id}` : ''),
        }));
    },
});
