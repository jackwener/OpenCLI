/**
 * LinkedIn Learning personalized recommendations via the
 * feedRecommendationGroups carousels endpoint. The `learner` view
 * returns a small set of carousels (e.g. "Top picks for you"); this
 * command flattens the cards across them into a ranked list.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, MAX_LIMIT, fetchLinkedInLearningApi, parseLimit } from './shared.js';

const MAX_PER_CAROUSEL = 25;

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

        const url = `https://www.linkedin.com/learning-api/feedRecommendationGroups?countPerCarousel=${MAX_PER_CAROUSEL}&q=learner`;
        const result = await fetchLinkedInLearningApi(page, url);
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

export const __test__ = { parseCard };
