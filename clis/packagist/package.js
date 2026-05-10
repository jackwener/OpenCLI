// packagist package — fetch a single Packagist package's metadata.
//
// Hits `https://packagist.org/packages/<vendor>/<package>.json`. Returns
// one row: latest stable version + release time, license, repository,
// description, lifetime / monthly / daily downloads, github stars, favers.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { PACKAGIST_BASE, packagistFetch, pickStableVersion, requirePackageName, trimDate } from './utils.js';

cli({
    site: 'packagist',
    name: 'package',
    access: 'read',
    description: 'Fetch a Packagist package\'s metadata (version, downloads, license, repo, GitHub stars)',
    domain: 'packagist.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Composer package "<vendor>/<package>" (e.g. "symfony/console", "monolog/monolog")' },
    ],
    columns: ['package', 'version', 'releasedAt', 'license', 'description', 'repository', 'githubStars', 'favers', 'downloads', 'monthlyDownloads', 'dailyDownloads', 'url'],
    func: async (args) => {
        const { full } = requirePackageName(args.name);
        const url = `${PACKAGIST_BASE}/packages/${full}.json`;
        const body = await packagistFetch(url, 'packagist package');
        const pkg = body?.package;
        if (!pkg || typeof pkg !== 'object') {
            throw new CommandExecutionError(`packagist package returned no "package" object for ${full}.`);
        }
        const versionKey = pickStableVersion(pkg.versions);
        const versionEntry = versionKey ? pkg.versions?.[versionKey] : null;
        const license = Array.isArray(versionEntry?.license) ? versionEntry.license.filter(Boolean).join(', ') : '';
        const downloads = pkg.downloads ?? {};
        return [{
            package: String(pkg.name ?? full).trim(),
            version: versionKey ? String(versionKey) : '',
            releasedAt: trimDate(versionEntry?.time),
            license,
            description: String(pkg.description ?? '').trim(),
            repository: String(pkg.repository ?? '').trim(),
            githubStars: pkg.github_stars != null ? Number(pkg.github_stars) : null,
            favers: pkg.favers != null ? Number(pkg.favers) : null,
            downloads: downloads.total != null ? Number(downloads.total) : null,
            monthlyDownloads: downloads.monthly != null ? Number(downloads.monthly) : null,
            dailyDownloads: downloads.daily != null ? Number(downloads.daily) : null,
            url: `https://packagist.org/packages/${full}`,
        }];
    },
});
