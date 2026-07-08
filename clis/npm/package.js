// npm package — fetch a single package's registry metadata.
//
// Hits `https://registry.npmjs.org/<pkg>` and projects the fields most useful
// for an agent: name, latest version, description, license, homepage,
// repository, bug tracker, maintainers, last-modified time. Download stats
// are intentionally separate (see `npm downloads`) so failure modes don't get
// silently folded into a registry-metadata response.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { NPM_REGISTRY, npmFetch, requirePackageName } from './utils.js';

function repoUrl(repo) {
    if (!repo) return '';
    if (typeof repo === 'string') return repo;
    if (typeof repo === 'object' && typeof repo.url === 'string') {
        return repo.url.replace(/^git\+/, '').replace(/\.git$/, '');
    }
    return '';
}

function bugUrl(bugs) {
    if (!bugs) return '';
    if (typeof bugs === 'string') return bugs;
    if (typeof bugs === 'object' && typeof bugs.url === 'string') return bugs.url;
    return '';
}

cli({
    site: 'npm',
    name: 'package',
    access: 'read',
    description: 'Single npm package metadata (latest version, license, homepage, repository). Use `npm downloads` for stats.',
    domain: 'registry.npmjs.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'npm package name (e.g. "react", "@vercel/og")' },
    ],
    columns: [
        'name', 'latestVersion', 'description', 'license', 'homepage', 'repository',
        'bugs', 'maintainers', 'keywords', 'created', 'modified', 'url',
    ],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const body = await npmFetch(`${NPM_REGISTRY}/${name.split('/').map(encodeURIComponent).join('/')}`, `npm package ${name}`);
        const latest = body?.['dist-tags']?.latest;
        if (!latest) {
            throw new EmptyResultError('npm package', `npm registry has no latest version for "${name}".`);
        }
        const v = body?.versions?.[latest] ?? {};
        const maintainers = Array.isArray(body.maintainers)
            ? body.maintainers.map((m) => (typeof m === 'object' && m ? m.name || m.email || '' : String(m))).filter(Boolean).join(', ')
            : '';
        const keywords = Array.isArray(v.keywords) ? v.keywords.join(', ') : '';
        return [{
            name: String(body.name ?? name),
            latestVersion: String(latest),
            description: String(v.description ?? body.description ?? ''),
            license: typeof v.license === 'string' ? v.license : (v.license?.type ?? ''),
            homepage: String(v.homepage ?? ''),
            repository: repoUrl(v.repository),
            bugs: bugUrl(v.bugs),
            maintainers,
            keywords,
            created: String(body.time?.created ?? '').slice(0, 10),
            modified: String(body.time?.modified ?? '').slice(0, 10),
            url: `https://www.npmjs.com/package/${name}`,
        }];
    },
});
