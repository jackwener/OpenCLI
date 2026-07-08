// maven search — search Maven Central by free-text keyword.
//
// Hits the Solr endpoint at `https://search.maven.org/solrsearch/select`.
// Returns the agent-useful projection: `groupId:artifactId` (round-trips
// into `maven artifact`), latest version, packaging, version count, last
// publish timestamp, repository.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MAVEN_BASE, mavenFetch, epochMsToIso, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'maven',
    name: 'search',
    access: 'read',
    description: 'Search Maven Central by keyword (artifact name, groupId, tag)',
    domain: 'search.maven.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "jackson", "guava", "ai.koog")' },
        { name: 'limit', type: 'int', default: 30, help: 'Max artifacts (1-200)' },
    ],
    columns: ['rank', 'coordinate', 'groupId', 'artifactId', 'latestVersion', 'packaging', 'versions', 'lastPublished', 'repository', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 30, 200);
        const url = `${MAVEN_BASE}?q=${encodeURIComponent(query)}&rows=${limit}&wt=json`;
        const body = await mavenFetch(url, 'maven search');
        const docs = Array.isArray(body?.response?.docs) ? body.response.docs : [];
        if (!docs.length) {
            throw new EmptyResultError('maven search', `No Maven Central artifacts matched "${query}".`);
        }
        return docs.slice(0, limit).map((d, i) => {
            const groupId = String(d.g ?? '').trim();
            const artifactId = String(d.a ?? '').trim();
            const coord = groupId && artifactId ? `${groupId}:${artifactId}` : '';
            return {
                rank: i + 1,
                coordinate: coord,
                groupId,
                artifactId,
                latestVersion: String(d.latestVersion ?? '').trim(),
                packaging: String(d.p ?? '').trim(),
                versions: d.versionCount != null ? Number(d.versionCount) : null,
                lastPublished: epochMsToIso(d.timestamp),
                repository: String(d.repositoryId ?? '').trim(),
                url: coord ? `https://central.sonatype.com/artifact/${groupId}/${artifactId}` : '',
            };
        });
    },
});
