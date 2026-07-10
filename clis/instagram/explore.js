import { cli } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const EXPLORE_URL = 'https://www.instagram.com/api/v1/discover/web/explore_grid/';

function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function buildExploreFetchScript() {
    return `(async () => {
    try {
      const res = await fetch(${JSON.stringify(EXPLORE_URL)}, {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459' },
      });
      if (!res.ok) return { error: 'HTTP ' + res.status };
      return { ok: true, data: await res.json() };
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  })()`;
}

function mapMedia(media) {
    return {
        user: media.user?.username || '',
        caption: (media.caption?.text || '').replace(/\n/g, ' ').substring(0, 100),
        // clips / reels expose engagement as play_count rather than like_count.
        likes: media.like_count ?? media.play_count ?? 0,
        comments: media.comment_count ?? 0,
        type: media.media_type === 1 ? 'photo' : media.media_type === 2 ? 'video' : 'carousel',
    };
}

/**
 * IG moved explore media out of the flat
 * `sectional_items[].layout_content.medias[]` path into mixed nested layout
 * shapes (`one_by_two_item.clips.items[].media`, `fill_items[]`, …). Walk
 * sectional_items recursively and collect every distinct `node.media`, deduped
 * by pk/id/code. The generic walk also still matches the legacy flat path. (#2091)
 */
export function collectExploreMedia(data, limit) {
    const seen = new Set();
    const posts = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        const media = node.media;
        if (media && typeof media === 'object' && (media.pk || media.id || media.code)) {
            const key = String(media.pk || media.id || media.code);
            if (!seen.has(key)) {
                seen.add(key);
                posts.push(mapMedia(media));
            }
        }
        for (const k in node) {
            if (k === 'media') continue; // already captured; don't re-descend into it
            visit(node[k]);
        }
    };
    visit(data?.sectional_items || []);
    const capped = Number.isInteger(limit) && limit > 0 ? posts.slice(0, limit) : posts;
    return capped.map((p, i) => ({ rank: i + 1, ...p }));
}

export const exploreCommand = cli({
    site: 'instagram',
    name: 'explore',
    access: 'read',
    description: 'Instagram explore/discover trending posts',
    domain: 'www.instagram.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'user', 'caption', 'likes', 'comments', 'type'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        await page.goto('https://www.instagram.com');
        const result = unwrapEvaluateResult(await page.evaluate(buildExploreFetchScript()));
        if (!result || result.error || !result.ok) {
            throw new CommandExecutionError(
                `instagram explore failed: ${result?.error || 'no response'} — make sure you are logged in to Instagram`,
            );
        }
        return collectExploreMedia(result.data, limit);
    },
});

export const __test__ = { collectExploreMedia, mapMedia, buildExploreFetchScript, unwrapEvaluateResult };
