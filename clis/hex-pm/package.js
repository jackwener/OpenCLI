// hex-pm package — fetch full Hex.pm package metadata.
//
// Hits `https://hex.pm/api/packages/<name>`. Returns the agent-useful
// projection: latest version + latest stable, total / recent downloads,
// description, license list, repository / GitHub link, owner count, doc URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HEX_BASE, hexFetch, requirePackageName } from './utils.js';

cli({
    site: 'hex-pm',
    name: 'package',
    access: 'read',
    description: 'Fetch full Hex.pm package metadata (Erlang / Elixir)',
    domain: 'hex.pm',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'package', positional: true, required: true, help: 'Hex package name (e.g. "phoenix", "ecto", "plug")' },
    ],
    columns: [
        'package', 'latestVersion', 'latestStableVersion', 'description', 'licenses',
        'github', 'docsUrl', 'downloadsAll', 'downloadsRecent', 'downloadsWeek', 'downloadsDay',
        'owners', 'releaseCount', 'insertedAt', 'updatedAt', 'url',
    ],
    func: async (args) => {
        const pkg = requirePackageName(args.package);
        const url = `${HEX_BASE}/packages/${encodeURIComponent(pkg)}`;
        const body = await hexFetch(url, 'hex-pm package');
        const meta = body?.meta || {};
        const links = meta.links || {};
        const downloads = body?.downloads || {};
        const owners = Array.isArray(body?.owners)
            ? body.owners.map((o) => String(o.username ?? '').trim()).filter(Boolean)
            : [];
        const licenses = Array.isArray(meta.licenses) ? meta.licenses : [];
        const github = String(links.GitHub ?? links.github ?? '').trim() || null;
        return [{
            package: pkg,
            latestVersion: String(body?.latest_version ?? '').trim() || null,
            latestStableVersion: String(body?.latest_stable_version ?? '').trim() || null,
            description: String(meta.description ?? '').trim() || null,
            licenses: licenses.length ? licenses.join(', ') : null,
            github,
            docsUrl: String(body?.docs_html_url ?? '').trim() || null,
            downloadsAll: typeof downloads.all === 'number' ? downloads.all : null,
            downloadsRecent: typeof downloads.recent === 'number' ? downloads.recent : null,
            downloadsWeek: typeof downloads.week === 'number' ? downloads.week : null,
            downloadsDay: typeof downloads.day === 'number' ? downloads.day : null,
            owners: owners.length ? owners.join(', ') : null,
            releaseCount: Array.isArray(body?.releases) ? body.releases.length : null,
            insertedAt: String(body?.inserted_at ?? '').trim() || null,
            updatedAt: String(body?.updated_at ?? '').trim() || null,
            url: String(body?.html_url ?? `https://hex.pm/packages/${pkg}`).trim(),
        }];
    },
});
