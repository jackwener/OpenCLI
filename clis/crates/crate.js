// crates crate — fetch a single crate's metadata.
//
// Hits `https://crates.io/api/v1/crates/<name>`. Returns the agent-useful
// projection: name, latest version, description, total + recent downloads,
// homepage / docs / repo, license (from latest version row), version count,
// created / updated timestamps.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CRATES_BASE, cratesFetch, requireCrateName } from './utils.js';

cli({
    site: 'crates',
    name: 'crate',
    access: 'read',
    description: 'Single crates.io crate metadata (latest version, downloads, license, repo)',
    domain: 'crates.io',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'crates.io crate name (e.g. "serde", "tokio")' },
    ],
    columns: [
        'name', 'latestVersion', 'description', 'downloads', 'recentDownloads', 'versions',
        'license', 'homepage', 'documentation', 'repository', 'keywords', 'categories', 'created', 'updated', 'url',
    ],
    func: async (args) => {
        const name = requireCrateName(args.name);
        const body = await cratesFetch(`${CRATES_BASE}/api/v1/crates/${encodeURIComponent(name)}`, `crates crate ${name}`);
        const c = body?.crate;
        if (!c || !c.id) {
            throw new EmptyResultError('crates crate', `crates.io returned no metadata for "${name}".`);
        }
        const versions = Array.isArray(body.versions) ? body.versions : [];
        const latestRow = versions.find((v) => v.num === c.newest_version)
            || versions.find((v) => v.num === c.max_stable_version)
            || versions[0]
            || {};
        const keywords = Array.isArray(body.keywords)
            ? body.keywords.map((k) => k?.keyword || k?.id || '').filter(Boolean).join(', ')
            : '';
        const categories = Array.isArray(body.categories)
            ? body.categories.map((cat) => cat?.category || cat?.slug || '').filter(Boolean).join(', ')
            : '';
        return [{
            name: String(c.name ?? c.id),
            latestVersion: String(c.newest_version ?? c.max_stable_version ?? c.max_version ?? ''),
            description: String(c.description ?? '').trim(),
            downloads: c.downloads != null ? Number(c.downloads) : null,
            recentDownloads: c.recent_downloads != null ? Number(c.recent_downloads) : null,
            versions: c.num_versions != null ? Number(c.num_versions) : versions.length,
            license: String(latestRow.license ?? ''),
            homepage: String(c.homepage ?? ''),
            documentation: String(c.documentation ?? ''),
            repository: String(c.repository ?? ''),
            keywords,
            categories,
            created: String(c.created_at ?? '').slice(0, 10),
            updated: String(c.updated_at ?? '').slice(0, 10),
            url: `https://crates.io/crates/${c.name ?? c.id}`,
        }];
    },
});
