// maven artifact — fetch a Maven Central artifact's recent version history.
//
// Hits Solr's `gav` core (`q=g:<groupId>+AND+a:<artifactId>` with
// `core=gav`) which returns one row per published version, newest first.
// Returns the agent-useful projection: each version + publish timestamp +
// packaging. If a specific `:version` is supplied, only that version is
// returned.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MAVEN_BASE, mavenFetch, epochMsToIso, requireBoundedInt, requireCoord } from './utils.js';

cli({
    site: 'maven',
    name: 'artifact',
    access: 'read',
    description: 'Fetch a Maven Central artifact\'s version history (groupId:artifactId[:version])',
    domain: 'search.maven.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'coordinate', positional: true, required: true, help: 'Maven coord "groupId:artifactId" or "groupId:artifactId:version"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max versions (1-200, ignored when version is pinned)' },
    ],
    columns: ['groupId', 'artifactId', 'version', 'packaging', 'publishedAt', 'tags', 'url'],
    func: async (args) => {
        const { groupId, artifactId, version } = requireCoord(args.coordinate);
        const limit = requireBoundedInt(args.limit, 20, 200);
        const filters = [`g:${groupId}`, `a:${artifactId}`];
        if (version) filters.push(`v:${version}`);
        const q = filters.join(' AND ');
        const rows = version ? 1 : limit;
        const url = `${MAVEN_BASE}?q=${encodeURIComponent(q)}&core=gav&rows=${rows}&wt=json`;
        const body = await mavenFetch(url, 'maven artifact');
        const docs = Array.isArray(body?.response?.docs) ? body.response.docs : [];
        const coordLabel = version ? `${groupId}:${artifactId}:${version}` : `${groupId}:${artifactId}`;
        if (!docs.length) {
            throw new EmptyResultError('maven artifact', `Maven Central has no published versions for ${coordLabel}.`);
        }
        return docs.map((d) => ({
            groupId: String(d.g ?? groupId).trim(),
            artifactId: String(d.a ?? artifactId).trim(),
            version: String(d.v ?? '').trim(),
            packaging: String(d.p ?? '').trim(),
            publishedAt: epochMsToIso(d.timestamp),
            tags: Array.isArray(d.tags) ? d.tags.filter(Boolean).join(', ') : '',
            url: `https://central.sonatype.com/artifact/${groupId}/${artifactId}/${d.v ?? ''}`.replace(/\/$/, ''),
        }));
    },
});
