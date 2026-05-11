// pypi package — fetch a single PyPI package's metadata.
//
// Hits `https://pypi.org/pypi/<pkg>/json`. Returns the most agent-useful
// projection: name, latest version, summary, author, license, homepage,
// project URLs, requires-python, last-modified time. Download stats are
// intentionally separate (see `pypi downloads`).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PYPI_BASE, pypiFetch, requirePackageName } from './utils.js';

function pickHomepage(info) {
    if (info.home_page) return String(info.home_page);
    const proj = info.project_urls;
    if (proj && typeof proj === 'object') {
        return String(proj.Homepage || proj.homepage || proj.Documentation || proj.Source || proj['Source Code'] || '');
    }
    return '';
}

function pickRepository(info) {
    const proj = info.project_urls;
    if (proj && typeof proj === 'object') {
        return String(proj.Source || proj['Source Code'] || proj.Repository || proj.repository || '');
    }
    return '';
}

cli({
    site: 'pypi',
    name: 'package',
    access: 'read',
    description: 'Single PyPI package metadata (latest version, license, homepage, classifiers)',
    domain: 'pypi.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'PyPI package name (e.g. "requests", "pandas")' },
    ],
    columns: [
        'name', 'latestVersion', 'summary', 'author', 'license', 'homepage', 'repository',
        'requiresPython', 'keywords', 'releases', 'firstReleased', 'lastReleased', 'url',
    ],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const body = await pypiFetch(`${PYPI_BASE}/pypi/${encodeURIComponent(name)}/json`, `pypi package ${name}`);
        const info = body?.info;
        if (!info || !info.name) {
            throw new EmptyResultError('pypi package', `PyPI returned no metadata for "${name}".`);
        }
        const releases = body?.releases ?? {};
        const releaseVersions = Object.keys(releases).filter((v) => Array.isArray(releases[v]) && releases[v].length > 0);
        // earliest / latest release timestamps from the upload_time fields
        let firstReleased = '';
        let lastReleased = '';
        for (const v of releaseVersions) {
            for (const file of releases[v]) {
                const t = String(file?.upload_time ?? '').slice(0, 10);
                if (!t) continue;
                if (!firstReleased || t < firstReleased) firstReleased = t;
                if (!lastReleased || t > lastReleased) lastReleased = t;
            }
        }
        return [{
            name: String(info.name),
            latestVersion: String(info.version ?? ''),
            summary: String(info.summary ?? ''),
            author: String(info.author ?? info.author_email ?? ''),
            license: String(info.license_expression ?? info.license ?? ''),
            homepage: pickHomepage(info),
            repository: pickRepository(info),
            requiresPython: String(info.requires_python ?? ''),
            keywords: String(info.keywords ?? ''),
            releases: releaseVersions.length,
            firstReleased,
            lastReleased,
            url: String(info.package_url ?? `${PYPI_BASE}/project/${info.name}/`),
        }];
    },
});
