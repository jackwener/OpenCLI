/**
 * hongguo reviews — every review the website exposes for one series.
 *
 * The web has no paginated comment API; it SSRs two fixed slices:
 * - series reviews (with a 1-10 rating): `detail_page.seriesSocialInfo.reviews`,
 *   9 rows on /detail?series_id=<id>;
 * - episode comments: `episodeSocialInfo.reviews`, 15 rows per episode on
 *   /player/<id>/<vid>, only for the web-playable episodes
 *   (vid_list[0 .. accessible_episode_cnt), usually 5). `pay_type` is ignored:
 *   the site marks no series as paid. Past that range the
 *   server silently serves episode 1 again, so a page whose `vid` does not
 *   echo the requested one is discarded rather than mislabelled.
 * The 15 episode comments rotate a little between requests (30 episodes
 * measured: +8.9% unique after five fetches, +6.0% after three; series reviews
 * did not change; numbers in docs/adapters/browser/hongguo.md), so `--rounds N`
 * re-fetches each episode page N times and merges the de-duplicated union.
 * `scope_total` is the site's full count for that series/episode, so callers
 * can see how much of it the web slice covers.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    HG_DOMAIN,
    REVIEWS_COLUMNS,
    clean,
    findLoaderEntry,
    formatChinaTime,
    hgFetchLoaderData,
    normalizeSeriesId,
    requireLimit,
    toInt,
} from './utils.js';

const SCOPES = ['all', 'series', 'episodes'];

export function parseReviewList(reviews, { scope, episode }) {
    const total = toInt(reviews?.total_count);
    const list = Array.isArray(reviews?.reviews) ? reviews.reviews : [];
    return list
        .filter((r) => clean(r?.content))
        .map((r) => ({
            scope,
            episode,
            user: clean(r.user_name),
            rating: toInt(r.rating),
            likes: toInt(r.digg_count),
            time: formatChinaTime(r.create_time, { time: true }),
            content: clean(r.content),
            scope_total: total,
        }));
}

/** The episodes the website will serve comments for. */
export function webEpisodeVids(seriesDetail) {
    const vids = Array.isArray(seriesDetail?.vid_list) ? seriesDetail.vid_list : [];
    return vids.slice(0, toInt(seriesDetail.accessible_episode_cnt) ?? 0);
}

cli({
    site: 'hongguo',
    name: 'reviews',
    access: 'read',
    description: '红果短剧评论（剧评 + 网页可看各集的评论，网页端能拿到的全部）',
    domain: HG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', positional: true, required: true, help: 'Series id (from feed/rank/search), or a /detail?series_id= URL' },
        { name: 'scope', default: 'all', choices: SCOPES, help: 'all, series (rated series reviews) or episodes (per-episode comments)' },
        { name: 'limit', type: 'int', default: 100, help: 'Max reviews (1-200)' },
        { name: 'rounds', type: 'int', default: 1, help: 'Fetches per episode page (1-5); comments rotate slightly, more rounds collect more' },
    ],
    columns: REVIEWS_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const scope = String(args.scope ?? 'all').trim();
        if (!SCOPES.includes(scope)) throw new ArgumentError(`scope must be one of: ${SCOPES.join(', ')}`);
        const limit = requireLimit(args.limit, 100, 200);
        const rounds = args.rounds == null || args.rounds === '' ? 1 : Number(args.rounds);
        if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) throw new ArgumentError('rounds must be an integer between 1 and 5');

        const detail = (await hgFetchLoaderData(`/detail?series_id=${seriesId}`, `reviews ${seriesId}`))?.detail_page;
        if (!detail?.seriesDetail) {
            throw new CommandExecutionError('hongguo reviews: detail page carried no seriesDetail', 'Hongguo likely changed its page structure.');
        }

        const rows = [];
        const seen = new Set();
        const add = (parsed) => {
            for (const row of parsed) {
                if (rows.length >= limit) return;
                const key = `${row.user}|${row.time}|${row.content}`;
                if (seen.has(key)) continue;
                seen.add(key);
                rows.push(row);
            }
        };

        if (scope !== 'episodes') {
            add(parseReviewList(detail.seriesSocialInfo?.reviews, { scope: 'series', episode: null }));
        }
        if (scope !== 'series') {
            const vids = webEpisodeVids(detail.seriesDetail);
            for (let i = 0; i < vids.length && rows.length < limit; i++) {
                for (let round = 0; round < rounds && rows.length < limit; round++) {
                    const loaderData = await hgFetchLoaderData(`/player/${seriesId}/${vids[i]}`, `reviews ${seriesId} episode ${i + 1}`);
                    const page = findLoaderEntry(loaderData, (v) => v.seriesDetail);
                    if (String(page?.vid ?? '') !== String(vids[i])) break;
                    add(parseReviewList(page.episodeSocialInfo?.reviews, { scope: 'episode', episode: i + 1 }));
                }
            }
        }

        if (!rows.length) {
            throw new EmptyResultError(`hongguo reviews ${seriesId}`, 'The website shows no reviews for this series in that scope.');
        }
        return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
    },
});
