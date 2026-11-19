// tiktok-symphony jobs — generations currently in the Create feed.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CARD_QUERY_SRC,
    COMPOSER_URL,
    HOST,
    VIDEO_MODES,
    normalizeLimit,
    waitForValue,
} from './utils.js';

const FEED_URL = `${COMPOSER_URL}?subApp=${VIDEO_MODES[0].subApp}`;

/**
 * Read every generation card in the feed. Runs in page context.
 *
 * A card leads with its prompt, then the model tag, then either a percentage
 * (still rendering) or its finished outputs. There is no status attribute to
 * read, so the presence of a percentage is the signal.
 */
const SCRAPE_SRC = `(() => {
    ${CARD_QUERY_SRC}
    const cards = __cards();
    if (!cards.length) return null;

    // Deliberately no asset count here: cards below the fold have not loaded
    // their <img> src yet, so any number would read as a confident 0.
    return cards.map(__cardState);
})()`;

cli({
    site: 'tiktok-symphony',
    name: 'jobs',
    aliases: ['queue'],
    description: 'Show generations in the Create feed with their render progress',
    access: 'read',
    example: 'opencli tiktok-symphony jobs',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: FEED_URL,
    // The Library/feed tiles mount lazily via IntersectionObserver. A
    // background tab is never rendered, so nothing ever intersects and the
    // grid stays empty — this command is only correct in the foreground.
    defaultWindowMode: 'foreground',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of cards to return (max 50)' },
        { name: 'pending', type: 'boolean', default: false, help: 'Only cards that have not produced an output yet (generating or finishing)' },
    ],
    columns: ['index', 'status', 'progress', 'taskId', 'model', 'prompt', 'error'],
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, 20, 50, 'limit');

        const cards = await waitForValue(page, SCRAPE_SRC, {
            label: 'Symphony Create feed',
            timeoutMs: 30000,
        });

        const rows = cards
            .map((card) => ({
                status: cardStatus(card),
                progress: card.cardProgress,
                taskId: card.cardTaskId,
                model: card.cardModel,
                prompt: card.cardPrompt,
                error: card.cardErrorCode ? `${card.cardErrorCode}: ${card.cardErrorText || 'rejected'}` : null,
            }))
            .filter((row) => (args.pending ? row.status === 'generating' || row.status === 'finishing' : true));

        if (rows.length === 0) {
            throw new EmptyResultError(
                'tiktok-symphony jobs',
                args.pending
                    ? 'Nothing is rendering right now'
                    : 'The Create feed is empty — it only keeps the last 3 days',
            );
        }

        return rows.slice(0, limit).map((row, i) => ({ index: i + 1, ...row }));
    },
});

/**
 * Classify a card without reading any prose.
 *
 * `ready` is claimed only when an output is actually mounted. Losing the
 * percentage is NOT completion — the site sits on "Almost there…" with no
 * readout for a long stretch, and a finished card that is scrolled out of view
 * has not loaded its outputs either. Both land in `finishing`, which says
 * "cannot confirm" instead of guessing.
 */
function cardStatus(card) {
    if (card.cardErrorCode) return 'failed';
    if (card.cardClip || card.cardStills > 0) return 'ready';
    if (card.cardProgress !== null) return 'generating';
    return 'finishing';
}
