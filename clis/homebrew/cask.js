// homebrew cask — fetch a single Homebrew cask's metadata.
//
// Hits `https://formulae.brew.sh/api/cask/<token>.json`. Returns one row for
// the macOS/.dmg-style package: canonical token, friendly name, version,
// homepage, deprecated / disabled flags, download URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { BREW_BASE, brewFetch, requireToken } from './utils.js';

cli({
    site: 'homebrew',
    name: 'cask',
    access: 'read',
    description: 'Fetch a Homebrew cask\'s metadata (version, homepage, deprecation, download URL)',
    domain: 'formulae.brew.sh',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'token', positional: true, required: true, help: 'Cask token (e.g. "firefox", "visual-studio-code", "google-chrome")' },
    ],
    columns: ['cask', 'tap', 'name', 'version', 'description', 'homepage', 'deprecated', 'disabled', 'download', 'url'],
    func: async (args) => {
        const token = requireToken(args.token, 'token');
        const url = `${BREW_BASE}/cask/${encodeURIComponent(token)}.json`;
        const body = await brewFetch(url, 'homebrew cask');
        const friendly = Array.isArray(body?.name) ? body.name.filter(Boolean).join(', ') : String(body?.name ?? '').trim();
        return [{
            cask: String(body?.token ?? token).trim(),
            tap: String(body?.tap ?? '').trim(),
            name: friendly,
            version: String(body?.version ?? '').trim(),
            description: String(body?.desc ?? '').trim(),
            homepage: String(body?.homepage ?? '').trim(),
            deprecated: Boolean(body?.deprecated),
            disabled: Boolean(body?.disabled),
            download: String(body?.url ?? '').trim(),
            url: `https://formulae.brew.sh/cask/${encodeURIComponent(token)}`,
        }];
    },
});
