// flathub app — full appstream metadata for a Flathub app id.
//
// Hits `/api/v2/appstream/<appId>`. AppStream IDs are reverse-DNS (e.g.
// "org.mozilla.firefox", "org.gnome.Calculator").
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    FLATHUB_API_BASE,
    FLATHUB_APP_BASE,
    flathubFetch,
    joinList,
    pickLatestRelease,
    requireAppId,
} from './utils.js';

cli({
    site: 'flathub',
    name: 'app',
    access: 'read',
    description: 'Full Flathub appstream metadata for an app id (license, categories, latest release)',
    domain: 'flathub.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'appId', positional: true, required: true, help: 'AppStream id (e.g. "org.mozilla.firefox", "org.gnome.Calculator")' },
    ],
    columns: [
        'appId',
        'name',
        'summary',
        'developer',
        'license',
        'isFreeLicense',
        'isEol',
        'categories',
        'keywords',
        'latestVersion',
        'latestReleaseDate',
        'homepage',
        'bugtracker',
        'donation',
        'url',
    ],
    func: async (args) => {
        const appId = requireAppId(args.appId);
        const url = `${FLATHUB_API_BASE}/appstream/${encodeURIComponent(appId)}`;
        const body = await flathubFetch(url, 'flathub app');
        if (!body || typeof body !== 'object' || !body.id) {
            throw new EmptyResultError('flathub app', `Flathub app "${appId}" returned empty payload.`);
        }
        const urls = body.urls && typeof body.urls === 'object' ? body.urls : {};
        const release = pickLatestRelease(body.releases);
        return [{
            appId: typeof body.id === 'string' ? body.id : appId,
            name: typeof body.name === 'string' ? body.name : null,
            summary: typeof body.summary === 'string' ? body.summary : null,
            developer: typeof body.developer_name === 'string' ? body.developer_name : null,
            license: typeof body.project_license === 'string' ? body.project_license : null,
            isFreeLicense: body.is_free_license === true,
            isEol: body.is_eol === true,
            categories: joinList(body.categories),
            keywords: joinList(body.keywords, 8),
            latestVersion: release.version,
            latestReleaseDate: release.date,
            homepage: typeof urls.homepage === 'string' ? urls.homepage : null,
            bugtracker: typeof urls.bugtracker === 'string' ? urls.bugtracker : null,
            donation: typeof urls.donation === 'string' ? urls.donation : null,
            url: `${FLATHUB_APP_BASE}/${appId}`,
        }];
    },
});
