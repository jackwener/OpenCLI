// ohpm package — fetch a single OpenHarmony OHPM package's metadata.
//
// Hits `oh-package/openapi/v1/detail/<name>/<version?>`. The latest version is
// returned when --version is omitted.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OHPM_API,
    dateFromMs,
    normalizeText,
    ohpmFetch,
    packageUrl,
    requirePackageName,
} from './utils.js';

function versionCount(versions) {
    return versions && typeof versions === 'object' ? Object.keys(versions).length : 0;
}

async function findLatestDescription(name) {
    const params = new URLSearchParams({
        condition: name,
        pageNum: '1',
        pageSize: '10',
        sortedType: 'relevancy',
        isHomePage: 'false',
    });
    const body = await ohpmFetch(`${OHPM_API}/v1/search?${params}`, `ohpm package ${name} search metadata`);
    const rows = Array.isArray(body?.body?.rows) ? body.body.rows : [];
    const exact = rows.find((row) => normalizeText(row.name) === name);
    return normalizeText(exact?.description);
}

cli({
    site: 'ohpm',
    name: 'package',
    access: 'read',
    description: 'Single OHPM package metadata (version, downloads, license, repository)',
    domain: 'ohpm.openharmony.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'OHPM package name (e.g. "@ohos/axios")' },
        { name: 'version', type: 'string', required: false, help: 'Package version; omit for latest' },
    ],
    columns: [
        'name', 'version', 'description', 'license', 'downloads', 'likes', 'points',
        'popularity', 'fileSize', 'fileCount', 'repository', 'keywords', 'publisher',
        'org', 'dependencies', 'devDependencies', 'dependents', 'versions', 'published', 'url',
    ],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const version = normalizeText(args.version);
        const path = version
            ? `${encodeURIComponent(name)}/${encodeURIComponent(version)}`
            : encodeURIComponent(name);
        const body = await ohpmFetch(`${OHPM_API}/v1/detail/${path}`, `ohpm package ${name}`);
        const item = body?.body;
        if (!item?.name) {
            throw new EmptyResultError('ohpm package', `OHPM returned no metadata for "${name}".`);
        }
        const description = normalizeText(item.description) || (!version ? await findLatestDescription(name) : '');
        return [{
            name: normalizeText(item.name),
            version: normalizeText(item.version),
            description,
            license: normalizeText(item.license),
            downloads: item.downloads != null ? Number(item.downloads) : null,
            likes: item.likes != null ? Number(item.likes) : null,
            points: item.points != null ? Number(item.points) : null,
            popularity: item.popularity != null ? Number(item.popularity) : null,
            fileSize: item.fileSize != null ? Number(item.fileSize) : null,
            fileCount: item.fileNums != null ? Number(item.fileNums) : null,
            repository: normalizeText(item.repository),
            keywords: Array.isArray(item.keywords) ? item.keywords.join(', ') : '',
            publisher: normalizeText(item.publisherName || item.authorName),
            org: normalizeText(item.org),
            dependencies: item.dependencies?.total != null ? Number(item.dependencies.total) : null,
            devDependencies: item.devDependencies?.total != null ? Number(item.devDependencies.total) : null,
            dependents: item.dependent?.total != null ? Number(item.dependent.total) : null,
            versions: versionCount(item.versions),
            published: dateFromMs(item.publishTime),
            url: packageUrl(item.name),
        }];
    },
});
