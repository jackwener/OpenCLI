// steamdb hot-tags — which tags / mechanics / genres the community is turning
// toward right now, hot -> cold.
//
// It answers "what KIND of game is getting attention", not "which game". It
// takes the rising cohort (same 7-day-gain signal as `steamdb rising`), samples
// the top --scan games, reads each game's Steam tags from its hover card, and
// aggregates the momentum onto the tags:
//   momentum(tag) = sum of the 7d follower/wishlist gain across sampled games
//                   carrying that tag.
// A tag is hot when many fast-rising games share it. Sorted by momentum desc.
//
// Strategy: DOM_STATE (rising table) + PAGE_FETCH (hover tags). browser:true.
//
// HONEST LIMIT: tags come only from the top --scan games of the loaded page set
// (see the note in rising.js). This is a momentum-weighted read of the current
// hot cohort, not an all-of-Steam tag census.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { buildCohort, DOMAIN, extractTable, fetchDetails, RISING_SOURCES } from './utils.js';

const PHASES = Object.keys(RISING_SOURCES);
const MAX_SCAN = 200;
const MAX_LIMIT = 100;

cli({
    site: 'steamdb',
    name: 'hot-tags',
    description: 'Tags / mechanics / genres the community is turning toward, ranked by the summed 7-day momentum of the rising games carrying them',
    access: 'read',
    example: 'opencli steamdb hot-tags --phase upcoming --scan 80 --limit 20',
    domain: DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'phase', type: 'string', default: 'all', help: `Cohort to read tags from: ${PHASES.join(' / ')}` },
        { name: 'scan', type: 'int', default: 60, help: `How many top-rising games to sample tags from (max ${MAX_SCAN}). 1 request/game` },
        { name: 'within-days', type: 'int', default: 60, help: 'For --phase new-releases: released within this many days' },
        { name: 'limit', type: 'int', default: 25, help: `Number of tags to return (max ${MAX_LIMIT})` },
        { name: 'min-games', type: 'int', default: 2, help: 'Only keep tags shared by at least this many sampled games' },
    ],
    columns: ['rank', 'tag', 'games', 'momentum', 'avgGain', 'sharePct', 'examples'],
    func: async (page, args) => {
        const phase = String(args.phase ?? 'all').trim().toLowerCase();
        const path = RISING_SOURCES[phase];
        if (!path) throw new ArgumentError(`Unknown --phase "${phase}". Valid: ${PHASES.join(', ')}`);

        const scan = Number(args.scan ?? 60);
        if (!Number.isInteger(scan) || scan <= 0) throw new ArgumentError('scan must be a positive integer');
        if (scan > MAX_SCAN) throw new ArgumentError(`scan must be <= ${MAX_SCAN}`);

        const limit = Number(args.limit ?? 25);
        if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
        if (limit > MAX_LIMIT) throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`);

        const withinDays = Number(args['within-days'] ?? 60);
        if (!Number.isInteger(withinDays) || withinDays <= 0) throw new ArgumentError('within-days must be a positive integer');

        const minGames = Number(args['min-games'] ?? 2);
        if (!Number.isInteger(minGames) || minGames <= 0) throw new ArgumentError('min-games must be a positive integer');

        const now = Math.floor(Date.now() / 1000);

        const rows = await extractTable(page, path);
        if (rows.length === 0) {
            throw new CommandExecutionError(`no table found on ${path} — the page may have shown a challenge or changed layout`);
        }

        const cohort = buildCohort(rows, phase, { withinDays, now }).slice(0, scan);
        if (cohort.length === 0) {
            const extra = phase === 'new-releases' ? ` released in the last ${withinDays} days` : '';
            throw new EmptyResultError('steamdb hot-tags', `no ${phase} games with a 7-day gain figure${extra}`);
        }

        const detailMap = await fetchDetails(page, cohort.map((r) => r.appid));

        // Aggregate 7d momentum onto each tag across the sampled games.
        const agg = new Map();
        let sampled = 0;
        for (const r of cohort) {
            const d = detailMap[r.appid];
            if (!d || !d.tags.length) continue;
            sampled += 1;
            for (const tag of d.tags) {
                let e = agg.get(tag);
                if (!e) { e = { tag, games: 0, momentum: 0, examples: [] }; agg.set(tag, e); }
                e.games += 1;
                e.momentum += r.gain7d;
                e.examples.push({ name: r.name, gain: r.gain7d });
            }
        }

        if (sampled === 0) {
            throw new EmptyResultError('steamdb hot-tags', `sampled ${cohort.length} ${phase} games but none exposed tags`);
        }

        const ranked = [...agg.values()]
            .filter((e) => e.games >= minGames)
            .sort((a, b) => b.momentum - a.momentum)
            .slice(0, limit);

        if (ranked.length === 0) {
            throw new EmptyResultError('steamdb hot-tags', `no tag was shared by >= ${minGames} of the ${sampled} sampled ${phase} games`);
        }

        return ranked.map((e, i) => ({
            rank: i + 1,
            tag: e.tag,
            games: e.games,
            momentum: e.momentum,
            avgGain: Math.round(e.momentum / e.games),
            sharePct: Math.round((e.games / sampled) * 100),
            examples: e.examples
                .sort((a, b) => b.gain - a.gain)
                .slice(0, 5)
                .map((x) => x.name)
                .filter(Boolean),
        }));
    },
});
