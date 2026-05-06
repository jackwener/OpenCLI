// hex-pm versions — list every published version of a Hex.pm package.
//
// Reuses the `https://hex.pm/api/packages/<name>` endpoint (releases[] is
// embedded; newest-first by `inserted_at` already). No extra requests needed.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { HEX_BASE, hexFetch, requireBoundedInt, requirePackageName } from './utils.js';

cli({
    site: 'hex-pm',
    name: 'versions',
    access: 'read',
    description: 'List every published Hex.pm package version (newest first)',
    domain: 'hex.pm',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'package', positional: true, required: true, help: 'Hex package name' },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows to return (1-500)' },
    ],
    columns: ['rank', 'package', 'version', 'insertedAt', 'hasDocs', 'url'],
    func: async (args) => {
        const pkg = requirePackageName(args.package);
        const limit = requireBoundedInt(args.limit, 30, 500);
        const url = `${HEX_BASE}/packages/${encodeURIComponent(pkg)}`;
        const body = await hexFetch(url, 'hex-pm versions');
        const releases = Array.isArray(body?.releases) ? body.releases : [];
        if (!releases.length) {
            throw new EmptyResultError('hex-pm versions', `hex.pm returned no releases for "${pkg}".`);
        }
        return releases.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            package: pkg,
            version: String(r.version ?? '').trim(),
            insertedAt: String(r.inserted_at ?? '').trim() || null,
            hasDocs: r.has_docs === true ? true : (r.has_docs === false ? false : null),
            url: `https://hex.pm/packages/${pkg}/${encodeURIComponent(r.version ?? '')}`,
        }));
    },
});
