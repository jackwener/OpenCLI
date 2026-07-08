/**
 * LinkedIn Learning personalized recommendations via the
 * feedRecommendationGroups carousels endpoint. The `learner` view
 * returns a small set of carousels (e.g. "Top picks for you"); this
 * command flattens the cards across them into a ranked list.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const DOMAIN = 'www.linkedin.com';
const MAX_LIMIT = 50;
const MAX_PER_CAROUSEL = 25;

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 10;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

function buildFetchScript(url, csrf) {
    return String.raw`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: {
          'csrf-token': ${JSON.stringify(csrf)},
          'x-restli-protocol-version': '2.0.0',
          accept: 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return { authRequired: true, status: res.status };
      if (!res.ok) return { error: 'HTTP ' + res.status };
      return { json: await res.json() };
    } catch (e) {
      return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
  })()`;
}

function parseCard(card, group, rank) {
    const slug = card?.slug || '';
    if (!slug) return null;
    return {
        rank,
        group: group?.title?.text || group?.annotation || '',
        type: card?.entityType || card?.localizedEntityName || '',
        title: card?.title?.text || card?.headline?.title?.text || card?.headline?.text || '',
        difficulty: card?.difficultyLevel || '',
        viewers: card?.viewerCount ?? '',
        url: slug ? `https://www.linkedin.com/learning/${slug}` : '',
    };
}

cli({
    site: 'linkedin-learning',
    name: 'trending',
    access: 'read',
    description: 'Browse LinkedIn Learning recommended courses across personalized carousels',
    domain: DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 10, help: `Maximum results to return (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'group', 'type', 'title', 'difficulty', 'viewers', 'url'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin-learning trending');
        const limit = parseLimit(args.limit);

        await page.goto('https://www.linkedin.com/learning/');
        await page.wait(3);

        const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
        const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
        if (!jsession) {
            throw new AuthRequiredError(DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
        }
        const csrf = jsession.replace(/^"|"$/g, '');

        const url = `https://www.linkedin.com/learning-api/feedRecommendationGroups?countPerCarousel=${MAX_PER_CAROUSEL}&q=learner`;
        const result = unwrapEvaluateResult(await page.evaluate(buildFetchScript(url, csrf)));
        if (result?.authRequired) {
            throw new AuthRequiredError(DOMAIN, `LinkedIn Learning auth failed (HTTP ${result.status ?? ''}).`);
        }
        if (!result?.json) {
            throw new CommandExecutionError(`LinkedIn Learning feedRecommendationGroups failed: ${result?.error ?? 'no payload'}`);
        }
        const groups = result.json?.elements;
        if (!Array.isArray(groups)) {
            throw new CommandExecutionError('LinkedIn Learning feedRecommendationGroups returned malformed payload: missing elements array');
        }
        const rows = [];
        const seen = new Set();
        let rank = 1;
        let sawCards = false;
        for (const group of groups) {
            const carousels = Array.isArray(group?.carousels) ? group.carousels : [];
            for (const carousel of carousels) {
                const cards = Array.isArray(carousel?.cards) ? carousel.cards : [];
                for (const card of cards) {
                    sawCards = true;
                    if (rows.length >= limit) break;
                    const slug = card?.slug;
                    if (!slug || seen.has(slug)) continue;
                    seen.add(slug);
                    const row = parseCard(card, carousel, rank);
                    if (!row) continue;
                    rows.push(row);
                    rank += 1;
                }
                if (rows.length >= limit) break;
            }
            if (rows.length >= limit) break;
        }
        if (rows.length === 0) {
            if (sawCards) {
                throw new CommandExecutionError('LinkedIn Learning feedRecommendationGroups returned no parseable cards with slug identity');
            }
            throw new EmptyResultError('LinkedIn Learning returned no personalized recommendations');
        }
        return rows;
    },
});

export const __test__ = { parseLimit, parseCard };
