// nuget package — full version history for a NuGet package id.
//
// Hits the registration index `api.nuget.org/v3/registration5-semver1/<id>/index.json`.
// The id path segment must be lowercase per NuGet's CDN routing.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { NUGET_REGISTRATION_BASE, joinAuthors, joinTags, nugetFetch, requirePackageId } from './utils.js';

cli({
    site: 'nuget',
    name: 'package',
    access: 'read',
    description: 'Full NuGet package version history (catalogEntry per release)',
    domain: 'api.nuget.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'NuGet package id (e.g. "Newtonsoft.Json", case-insensitive)' },
    ],
    columns: [
        'rank',
        'id',
        'version',
        'title',
        'authors',
        'tags',
        'language',
        'licenseExpression',
        'projectUrl',
        'published',
        'listed',
        'url',
    ],
    func: async (args) => {
        const id = requirePackageId(args.id);
        const url = `${NUGET_REGISTRATION_BASE}/${encodeURIComponent(id.toLowerCase())}/index.json`;
        const body = await nugetFetch(url, 'nuget package');
        const pages = Array.isArray(body?.items) ? body.items : [];
        // Each page can be inline (with `items`) or a stub that needs another fetch
        // for older packages. Inline is the common case for everything published in
        // the last few years. We follow stub pages once each — at most ~5 round-trips.
        const allEntries = [];
        for (const [pageIndex, page] of pages.entries()) {
            let pageItems = Array.isArray(page?.items) ? page.items : null;
            if (!pageItems) {
                // Stub page → fetch the leaf.
                const pageUrl = typeof page?.['@id'] === 'string' ? page['@id'] : null;
                if (!pageUrl) {
                    throw new CommandExecutionError(
                        `nuget package registration page ${pageIndex + 1} is missing @id for package "${id}"`,
                    );
                }
                const leaf = await nugetFetch(pageUrl, 'nuget package page');
                if (!Array.isArray(leaf?.items)) {
                    throw new CommandExecutionError(
                        `nuget package registration leaf ${pageUrl} did not include an items array`,
                    );
                }
                pageItems = leaf.items;
            }
            for (const it of pageItems) {
                if (!it || typeof it !== 'object' || !it.catalogEntry || typeof it.catalogEntry !== 'object') {
                    throw new CommandExecutionError(
                        `nuget package registration page ${pageIndex + 1} contains a malformed version entry`,
                    );
                }
                allEntries.push(it);
            }
        }
        if (!allEntries.length) {
            throw new EmptyResultError('nuget package', `No published versions found for NuGet package "${id}".`);
        }
        // Sort by published desc; ties broken by version string descending.
        const sorted = [...allEntries].sort((a, b) => {
            const ap = a?.catalogEntry?.published ?? '';
            const bp = b?.catalogEntry?.published ?? '';
            if (ap !== bp) return bp.localeCompare(ap);
            const av = a?.catalogEntry?.version ?? '';
            const bv = b?.catalogEntry?.version ?? '';
            return bv.localeCompare(av);
        });
        return sorted.map((entry, i) => {
            const cat = entry?.catalogEntry ?? {};
            return {
                rank: i + 1,
                id: typeof cat?.id === 'string' ? cat.id : id,
                version: typeof cat?.version === 'string' ? cat.version : null,
                title: typeof cat?.title === 'string' ? cat.title : null,
                authors: joinAuthors(cat?.authors),
                tags: joinTags(cat?.tags),
                language: typeof cat?.language === 'string' ? cat.language : null,
                licenseExpression: typeof cat?.licenseExpression === 'string' ? cat.licenseExpression : null,
                projectUrl: typeof cat?.projectUrl === 'string' ? cat.projectUrl : null,
                published: typeof cat?.published === 'string' ? cat.published : null,
                listed: typeof cat?.listed === 'boolean' ? cat.listed : null,
                url: typeof cat?.id === 'string' && typeof cat?.version === 'string'
                    ? `https://www.nuget.org/packages/${cat.id}/${cat.version}` : '',
            };
        });
    },
});
