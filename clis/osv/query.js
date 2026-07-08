// osv query — find vulnerabilities affecting a given package (and optional version).
//
// Hits `POST https://api.osv.dev/v1/query` with `{package:{name,ecosystem}, version?}`.
// Returns one row per vulnerability ranked by published date (newest first), so
// agents can answer "is package X@Y vulnerable?" in one shot.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OSV_BASE, osvPost, requireBoundedInt, requireEcosystem, requireString, severityLabel, trimDate,
} from './utils.js';

cli({
    site: 'osv',
    name: 'query',
    access: 'read',
    description: 'OSV.dev vulnerabilities affecting a package (optionally pinned to a version)',
    domain: 'osv.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'package', positional: true, type: 'string', required: true, help: 'Package name (e.g. "lodash", "django")' },
        { name: 'ecosystem', type: 'string', required: true, help: 'OSV ecosystem (npm / PyPI / Go / Maven / NuGet / RubyGems / crates.io / Packagist / ...)' },
        { name: 'version', type: 'string', required: false, help: 'Pin to a specific version (e.g. "4.17.20"); omit for all known vulns' },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows to return (1-200)' },
    ],
    columns: [
        'rank', 'id', 'summary', 'severity', 'aliases',
        'published', 'modified', 'affectedPackages', 'url',
    ],
    func: async (args) => {
        const name = requireString(args.package, 'package');
        const ecosystem = requireEcosystem(args.ecosystem);
        const limit = requireBoundedInt(args.limit, 30, 200, 'limit');
        const payload = { package: { name, ecosystem } };
        if (args.version != null && String(args.version).trim() !== '') {
            payload.version = String(args.version).trim();
        }
        const body = await osvPost(`${OSV_BASE}/v1/query`, payload, `osv query ${ecosystem}:${name}`);
        const vulns = Array.isArray(body?.vulns) ? body.vulns : [];
        if (vulns.length === 0) {
            throw new EmptyResultError(
                'osv query',
                `OSV.dev returned no vulnerabilities for ${ecosystem}:${name}${payload.version ? `@${payload.version}` : ''}.`,
            );
        }
        const sorted = vulns
            .slice()
            .sort((a, b) => String(b?.published ?? '').localeCompare(String(a?.published ?? '')))
            .slice(0, limit);
        return sorted.map((v, i) => {
            const affected = Array.isArray(v.affected) ? v.affected : [];
            const pkgPairs = [];
            for (const a of affected) {
                const eco = a?.package?.ecosystem;
                const aname = a?.package?.name;
                if (eco && aname) pkgPairs.push(`${eco}:${aname}`);
            }
            const aliases = Array.isArray(v.aliases) ? v.aliases.filter(Boolean) : [];
            return {
                rank: i + 1,
                id: String(v.id ?? ''),
                summary: String(v.summary ?? '').trim(),
                severity: severityLabel(v),
                aliases: aliases.join(', '),
                published: trimDate(v.published),
                modified: trimDate(v.modified),
                affectedPackages: pkgPairs.join(', '),
                url: v.id ? `https://osv.dev/vulnerability/${v.id}` : '',
            };
        });
    },
});
