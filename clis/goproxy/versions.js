// goproxy versions — published version tags for one Go module, newest first.
//
// Hits `https://proxy.golang.org/<module>/@v/list` (plain text, one tag per line).
// Sort by semver (descending) and return up to `--limit` rows; per-tag publish
// time comes from `@v/<ver>.info` and is fetched only when `--with-time` is set,
// since it costs one HTTP request per row.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    GOPROXY_BASE, goproxyJson, goproxyText, requireBoundedInt, requireModulePath, sortVersionsDescending, trimDate,
} from './utils.js';

cli({
    site: 'goproxy',
    name: 'versions',
    access: 'read',
    description: 'Published version tags for a Go module (newest first), optionally with publish times',
    domain: 'proxy.golang.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'module', positional: true, type: 'string', required: true, help: 'Go module path (e.g. "github.com/gin-gonic/gin")' },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows to return (1-200)' },
        { name: 'with-time', type: 'boolean', default: false, help: 'Fetch each version\'s publish time (one extra request per row)' },
    ],
    columns: [
        'rank', 'module', 'version', 'publishedAt', 'url',
    ],
    func: async (args) => {
        const modulePath = requireModulePath(args.module);
        const limit = requireBoundedInt(args.limit, 30, 200, 'limit');
        const withTime = args['with-time'] === true;
        const encoded = modulePath.split('/').map(encodeURIComponent).join('/');
        const text = await goproxyText(`${GOPROXY_BASE}/${encoded}/@v/list`, `goproxy versions ${modulePath}`);
        const raw = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (raw.length === 0) {
            throw new EmptyResultError('goproxy versions', `proxy.golang.org returned no published versions for "${modulePath}".`);
        }
        const sorted = sortVersionsDescending(raw).slice(0, limit);
        if (sorted.length === 0) {
            throw new EmptyResultError('goproxy versions', `"${modulePath}" has no semver-shaped tags on proxy.golang.org.`);
        }
        const rows = sorted.map((v, i) => ({
            rank: i + 1,
            module: modulePath,
            version: v,
            publishedAt: null,
            url: `${GOPROXY_BASE}/${encoded}/@v/${encodeURIComponent(v)}.info`,
        }));
        if (withTime) {
            // Sequential to keep the proxy happy; cap at limit which is already <=200.
            for (const row of rows) {
                const info = await goproxyJson(`${GOPROXY_BASE}/${encoded}/@v/${encodeURIComponent(row.version)}.info`, `goproxy versions ${modulePath} ${row.version}`);
                row.publishedAt = trimDate(info?.Time);
            }
        }
        return rows;
    },
});
