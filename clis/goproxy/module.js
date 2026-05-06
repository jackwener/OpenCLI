// goproxy module — latest version + origin metadata for one Go module.
//
// Hits `https://proxy.golang.org/<module>/@latest`, returning the canonical
// version, publish time, and the upstream VCS / commit / tag the proxy resolved.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GOPROXY_BASE, goproxyJson, requireModulePath, trimDate } from './utils.js';

cli({
    site: 'goproxy',
    name: 'module',
    access: 'read',
    description: 'Latest version + VCS origin metadata for a Go module on proxy.golang.org',
    domain: 'proxy.golang.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'module', positional: true, type: 'string', required: true, help: 'Go module path (e.g. "github.com/gin-gonic/gin", "golang.org/x/net")' },
    ],
    columns: [
        'module', 'version', 'publishedAt', 'vcs', 'repository',
        'commit', 'ref', 'pkgGoDevUrl', 'url',
    ],
    func: async (args) => {
        const modulePath = requireModulePath(args.module);
        // GOPROXY spec requires lowercase percent-encoding for capital letters in the
        // module path (e.g. github.com/Foo/Bar -> github.com/!foo/!bar). Module paths
        // we accept here are lowercase-only by convention; we still encode each segment.
        const encoded = modulePath.split('/').map(encodeURIComponent).join('/');
        const detail = await goproxyJson(`${GOPROXY_BASE}/${encoded}/@latest`, `goproxy module ${modulePath}`);
        if (!detail || !detail.Version) {
            throw new EmptyResultError('goproxy module', `proxy.golang.org returned no @latest entry for "${modulePath}".`);
        }
        const origin = detail.Origin && typeof detail.Origin === 'object' ? detail.Origin : {};
        return [{
            module: modulePath,
            version: String(detail.Version),
            publishedAt: trimDate(detail.Time),
            vcs: String(origin.VCS ?? '').trim(),
            repository: String(origin.URL ?? '').trim(),
            commit: String(origin.Hash ?? '').trim(),
            ref: String(origin.Ref ?? '').trim(),
            pkgGoDevUrl: `https://pkg.go.dev/${modulePath}`,
            url: `${GOPROXY_BASE}/${encoded}/@latest`,
        }];
    },
});
