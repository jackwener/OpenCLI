// rubygems gem — fetch a single gem's metadata from RubyGems.org.
//
// Hits `https://rubygems.org/api/v1/gems/<name>.json`. Returns a one-row
// projection: latest version + release date, lifetime / version downloads,
// license(s), author(s), homepage, source, bug tracker, short info.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { GEMS_BASE, gemsFetch, requireGemName, trimDate } from './utils.js';

cli({
    site: 'rubygems',
    name: 'gem',
    access: 'read',
    description: 'Fetch a RubyGems.org gem\'s metadata (version, downloads, license, links)',
    domain: 'rubygems.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Gem name (e.g. "rails", "sidekiq")' },
    ],
    columns: ['gem', 'version', 'releasedAt', 'downloads', 'versionDownloads', 'license', 'authors', 'homepage', 'source', 'bugs', 'info', 'url'],
    func: async (args) => {
        const name = requireGemName(args.name);
        const url = `${GEMS_BASE}/gems/${encodeURIComponent(name)}.json`;
        const body = await gemsFetch(url, 'rubygems gem');
        const licenses = Array.isArray(body?.licenses) ? body.licenses.filter(Boolean).join(', ') : '';
        const meta = body?.metadata ?? {};
        return [{
            gem: String(body?.name ?? name).trim(),
            version: String(body?.version ?? '').trim(),
            releasedAt: trimDate(body?.version_created_at),
            downloads: body?.downloads != null ? Number(body.downloads) : null,
            versionDownloads: body?.version_downloads != null ? Number(body.version_downloads) : null,
            license: licenses,
            authors: String(body?.authors ?? '').trim(),
            homepage: String(body?.homepage_uri ?? '').trim(),
            source: String(body?.source_code_uri ?? meta.source_code_uri ?? '').trim(),
            bugs: String(body?.bug_tracker_uri ?? meta.bug_tracker_uri ?? '').trim(),
            info: String(body?.info ?? '').trim(),
            url: String(body?.project_uri ?? `https://rubygems.org/gems/${name}`).trim(),
        }];
    },
});
