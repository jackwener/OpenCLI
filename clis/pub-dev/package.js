// pub-dev package — fetch latest pub.dev package metadata.
//
// Hits `https://pub.dev/api/packages/<name>`. Returns the agent-useful
// projection: latest version + published timestamp, description, repository /
// homepage, SDK constraint, dependency count, license info (best-effort from
// pubspec).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { PUB_BASE, pubFetch, requirePackageName } from './utils.js';

cli({
    site: 'pub-dev',
    name: 'package',
    access: 'read',
    description: 'Fetch latest pub.dev package metadata (Dart / Flutter)',
    domain: 'pub.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'package', positional: true, required: true, help: 'pub.dev package name (e.g. "http", "provider", "riverpod")' },
    ],
    columns: [
        'package', 'version', 'publishedAt', 'description', 'repository', 'homepage',
        'sdk', 'flutter', 'dependencies', 'devDependencies', 'topics', 'archive', 'url',
    ],
    func: async (args) => {
        const pkg = requirePackageName(args.package);
        const url = `${PUB_BASE}/packages/${encodeURIComponent(pkg)}`;
        const body = await pubFetch(url, 'pub-dev package');
        const latest = body?.latest || {};
        const pubspec = latest.pubspec || {};
        const env = pubspec.environment || {};
        const deps = pubspec.dependencies && typeof pubspec.dependencies === 'object'
            ? Object.keys(pubspec.dependencies)
            : [];
        const devDeps = pubspec.dev_dependencies && typeof pubspec.dev_dependencies === 'object'
            ? Object.keys(pubspec.dev_dependencies)
            : [];
        const topics = Array.isArray(pubspec.topics) ? pubspec.topics : [];
        return [{
            package: pkg,
            version: String(latest.version ?? '').trim() || null,
            publishedAt: String(latest.published ?? '').trim() || null,
            description: String(pubspec.description ?? '').trim() || null,
            repository: String(pubspec.repository ?? '').trim() || null,
            homepage: String(pubspec.homepage ?? '').trim() || null,
            sdk: String(env.sdk ?? '').trim() || null,
            flutter: String(env.flutter ?? '').trim() || null,
            dependencies: deps.length ? deps.join(', ') : null,
            devDependencies: devDeps.length ? devDeps.join(', ') : null,
            topics: topics.length ? topics.join(', ') : null,
            archive: String(latest.archive_url ?? '').trim() || null,
            url: `https://pub.dev/packages/${pkg}`,
        }];
    },
});
