// pub-dev versions — list every published version of a pub.dev package.
//
// Uses the same `https://pub.dev/api/packages/<name>` endpoint as `pub-dev
// package` and walks the `versions[]` list (newest-first; pub.dev returns
// versions oldest-first, we reverse). Each entry carries `published` and the
// archive URL — no extra requests needed.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PUB_BASE, pubFetch, requireBoundedInt, requirePackageName } from './utils.js';

cli({
    site: 'pub-dev',
    name: 'versions',
    access: 'read',
    description: 'List every published pub.dev package version (newest first)',
    domain: 'pub.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'package', positional: true, required: true, help: 'pub.dev package name' },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows to return (1-500)' },
    ],
    columns: ['rank', 'package', 'version', 'publishedAt', 'archive', 'url'],
    func: async (args) => {
        const pkg = requirePackageName(args.package);
        const limit = requireBoundedInt(args.limit, 30, 500);
        const url = `${PUB_BASE}/packages/${encodeURIComponent(pkg)}`;
        const body = await pubFetch(url, 'pub-dev versions');
        const versions = Array.isArray(body?.versions) ? body.versions : [];
        if (!versions.length) {
            throw new EmptyResultError('pub-dev versions', `pub.dev returned no versions for "${pkg}".`);
        }
        // pub.dev API returns versions oldest-first. Reverse so newest sits at rank 1.
        const newestFirst = [...versions].reverse();
        return newestFirst.slice(0, limit).map((entry, i) => ({
            rank: i + 1,
            package: pkg,
            version: String(entry.version ?? '').trim(),
            publishedAt: String(entry.published ?? '').trim() || null,
            archive: String(entry.archive_url ?? '').trim() || null,
            url: `https://pub.dev/packages/${pkg}/versions/${encodeURIComponent(entry.version ?? '')}`,
        }));
    },
});
