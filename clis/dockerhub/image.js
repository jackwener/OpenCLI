// dockerhub image — fetch a single Docker Hub repository's metadata.
//
// Hits `https://hub.docker.com/v2/repositories/<owner>/<name>`. Bare names
// resolve to the implicit `library` owner used for Docker official images
// (so `dockerhub image nginx` ≡ `dockerhub image library/nginx`). Returns a
// one-row projection: official-flag, star / pull counters, last-updated /
// registered timestamps, repo status, short description, hub URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { HUB_BASE, hubFetch, parseImage } from './utils.js';

function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    // Docker Hub returns mixed precision (`...45Z` and `...35.286495Z`). Drop
    // the fractional part so all timestamp columns share `YYYY-MM-DDTHH:MM:SSZ`.
    const noFrac = s.replace(/\.\d+/, '');
    return noFrac.endsWith('Z') ? noFrac : `${noFrac}Z`;
}

cli({
    site: 'dockerhub',
    name: 'image',
    access: 'read',
    description: 'Fetch a Docker Hub repository\'s public metadata (stars, pulls, last updated, status)',
    domain: 'hub.docker.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'image', positional: true, required: true, help: 'Image name (e.g. "nginx", "library/nginx", "bitnami/redis")' },
    ],
    columns: ['image', 'official', 'stars', 'pulls', 'description', 'lastUpdated', 'lastModified', 'registered', 'status', 'url'],
    func: async (args) => {
        const { owner, name } = parseImage(args.image);
        const url = `${HUB_BASE}/repositories/${owner}/${name}/`;
        const body = await hubFetch(url, 'dockerhub image');
        const namespace = String(body?.namespace ?? owner).trim();
        const isOfficial = namespace === 'library' || namespace === '_';
        const image = isOfficial ? `library/${name}` : `${namespace}/${name}`;
        return [{
            image,
            official: isOfficial,
            stars: body?.star_count != null ? Number(body.star_count) : null,
            pulls: body?.pull_count != null ? Number(body.pull_count) : null,
            description: String(body?.description ?? '').trim(),
            lastUpdated: trimDate(body?.last_updated),
            lastModified: trimDate(body?.last_modified),
            registered: trimDate(body?.date_registered),
            status: String(body?.status_description ?? '').trim(),
            url: `https://hub.docker.com/r/${image}`,
        }];
    },
});
