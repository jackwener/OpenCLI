// homebrew formula — fetch a single Homebrew core formula's metadata.
//
// Hits `https://formulae.brew.sh/api/formula/<name>.json`. Returns one row:
// canonical name, latest stable version, license, dependencies, deprecated /
// disabled flags, homepage, source tarball URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { BREW_BASE, brewFetch, requireToken } from './utils.js';

cli({
    site: 'homebrew',
    name: 'formula',
    access: 'read',
    description: 'Fetch a Homebrew formula\'s metadata (version, license, deps, deprecation, source)',
    domain: 'formulae.brew.sh',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Formula name (e.g. "wget", "gcc@13", "imagemagick")' },
    ],
    columns: ['formula', 'tap', 'version', 'license', 'description', 'homepage', 'dependencies', 'deprecated', 'disabled', 'source', 'url'],
    func: async (args) => {
        const name = requireToken(args.name, 'formula');
        const url = `${BREW_BASE}/formula/${encodeURIComponent(name)}.json`;
        const body = await brewFetch(url, 'homebrew formula');
        const deps = Array.isArray(body?.dependencies) ? body.dependencies.filter(Boolean) : [];
        const stableUrl = String(body?.urls?.stable?.url ?? '').trim();
        return [{
            formula: String(body?.name ?? name).trim(),
            tap: String(body?.tap ?? '').trim(),
            version: String(body?.versions?.stable ?? '').trim(),
            license: String(body?.license ?? '').trim(),
            description: String(body?.desc ?? '').trim(),
            homepage: String(body?.homepage ?? '').trim(),
            dependencies: deps.join(', '),
            deprecated: Boolean(body?.deprecated),
            disabled: Boolean(body?.disabled),
            source: stableUrl,
            url: `https://formulae.brew.sh/formula/${encodeURIComponent(name)}`,
        }];
    },
});
