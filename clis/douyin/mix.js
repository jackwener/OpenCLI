/**
 * Douyin mix — every video of a 合集 (collection) in episode order.
 *
 * Short-drama producers publish a series as a mix, one video per episode, so
 * this is the episode list that `douyin comments` can then walk. Input is a
 * mix id, a www.douyin.com/collection/<mix_id> URL, or a video URL / share
 * link whose video belongs to a mix. A bare number is taken as a mix id:
 * mix ids and video ids look alike, so pass a video as a URL.
 *
 * `/aweme/v1/web/mix/aweme/` pages by `cursor` (20 per page). Requests run in
 * a logged-in www.douyin.com page so the site's JS signs them.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { browserFetch } from './_shared/browser-fetch.js';
import { unwrapEvaluateResult } from './_shared/evaluate-result.js';
import { resolveToId } from './_shared/video-id.js';
import { formatChinaTime, requireCount, walkPages } from './_shared/paging.js';

export const MAX_MIX_VIDEOS = 2000;
const MIX_PAGE_SIZE = 20;
const ID = /^\d{16,20}$/;
export const MIX_COLUMNS = ['episode', 'aweme_id', 'desc', 'duration_s', 'digg', 'comment', 'collect', 'share', 'created', 'author', 'mix_id', 'mix_name', 'url'];

/** `{ mixId }` for a mix id / collection URL, `{ video }` for anything that names a video. */
export function parseMixTarget(input) {
    const text = String(input ?? '').trim();
    if (!text) throw new ArgumentError('douyin mix 需要 <mix_id / 合集链接 / 视频链接>');
    if (ID.test(text)) return { mixId: text };
    let url;
    try { url = new URL(text); }
    catch { throw new ArgumentError(`"${text}" is not a Douyin mix id or URL`); }
    const mixId = url.hostname === 'www.douyin.com' && url.protocol === 'https:'
        ? url.pathname.match(/^\/collection\/(\d{16,20})\/?$/)?.[1]
        : undefined;
    return mixId ? { mixId } : { video: text };
}

export function toMixRow(a, fallbackEpisode) {
    const st = a.statistics || {};
    const id = String(a.aweme_id ?? '');
    return {
        episode: a.mix_info?.statis?.current_episode ?? fallbackEpisode,
        aweme_id: id,
        desc: a.desc ?? '',
        duration_s: Math.round((a.video?.duration ?? 0) / 1000),
        digg: st.digg_count ?? 0,
        comment: st.comment_count ?? 0,
        collect: st.collect_count ?? 0,
        share: st.share_count ?? 0,
        created: formatChinaTime(a.create_time),
        author: a.author?.nickname ?? '',
        mix_id: String(a.mix_info?.mix_id ?? ''),
        mix_name: a.mix_info?.mix_name ?? '',
        url: `https://www.douyin.com/video/${id}`,
    };
}

cli({
    site: 'douyin',
    name: 'mix',
    access: 'read',
    description: '合集（短剧分集）里的全部视频，按集数排序',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    example: 'opencli douyin mix 7697274036942571554 --limit 200 -f json',
    args: [
        { name: 'target', required: true, positional: true, help: 'mix_id / https://www.douyin.com/collection/<mix_id> / 合集内任一视频的链接' },
        { name: 'limit', type: 'int', default: 100, help: `Max videos (1-${MAX_MIX_VIDEOS})` },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds for the whole crawl (default: 300); raise it for long threads' },
    ],
    columns: MIX_COLUMNS,
    func: async (page, kwargs) => {
        const limit = requireCount(kwargs.limit, 100, MAX_MIX_VIDEOS);
        const target = parseMixTarget(kwargs.target);
        let mixId = target.mixId;
        if (mixId) {
            // /collection/<id> redirects to its first video; a page that is still
            // settling detaches mid-crawl, so land on that video URL explicitly.
            await page.goto(`https://www.douyin.com/collection/${mixId}`);
            await page.wait({ time: 2.5 });
            const landed = String(unwrapEvaluateResult(await page.evaluate('location.pathname')) ?? '').match(/^\/video\/(\d{16,20})/)?.[1];
            if (landed) {
                await page.goto(`https://www.douyin.com/video/${landed}`);
                await page.wait({ time: 2.5 });
            }
        } else {
            const id = await resolveToId(target.video);
            if (!id) throw new ArgumentError(`没能从输入里解析出视频 ID: ${target.video}`);
            await page.goto(`https://www.douyin.com/video/${id}`);
            await page.wait({ time: 2.5 });
            const data = await browserFetch(page, 'GET', `https://www.douyin.com/aweme/v1/web/aweme/detail/?${new URLSearchParams({ aweme_id: id, aid: '6383' })}`);
            const d = data?.aweme_detail;
            if (!d || String(d.aweme_id) !== id) throw new CommandExecutionError('Douyin detail response has an invalid or mismatched aweme_id');
            mixId = String(d.mix_info?.mix_id ?? '');
            if (!ID.test(mixId)) throw new EmptyResultError('douyin mix', `视频 ${id} 不属于任何合集`);
        }

        const rows = [];
        const seen = new Set();
        await walkPages(page, (cursor) => browserFetch(page, 'GET',
            `https://www.douyin.com/aweme/v1/web/mix/aweme/?${new URLSearchParams({ mix_id: mixId, cursor: String(cursor), count: String(MIX_PAGE_SIZE), aid: '6383' })}`,
        ), 'aweme_list', limit, (a) => {
            const row = toMixRow(a, rows.length + 1);
            if (!row.aweme_id || seen.has(row.aweme_id)) return false;
            seen.add(row.aweme_id);
            rows.push(row);
            return true;
        });
        if (!rows.length) throw new EmptyResultError('douyin mix', `合集 ${mixId} 没有返回视频（id 不对或合集已删除）`);
        return rows;
    },
});
