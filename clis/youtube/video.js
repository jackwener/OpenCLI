/**
 * YouTube video metadata — fetch watch HTML and parse bootstrap data without opening the watch UI.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractJsonAssignmentFromHtml, parseVideoId, prepareYoutubeApiPage } from './utils.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

function requireVideoPayload(value) {
    const payload = unwrapBrowserResult(value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError('Failed to extract video metadata from page');
    }
    if (payload.error) {
        throw new CommandExecutionError(String(payload.error));
    }
    if (typeof payload.playabilityStatus !== 'string') {
        throw new CommandExecutionError('YouTube video metadata is missing playabilityStatus');
    }
    if (typeof payload.playabilityReason !== 'string') {
        throw new CommandExecutionError('YouTube video metadata is missing playabilityReason');
    }
    if (typeof payload.membersOnly !== 'boolean') {
        throw new CommandExecutionError('YouTube video metadata is missing membersOnly');
    }
    return payload;
}

cli({
    site: 'youtube',
    name: 'video',
    access: 'read',
    description: 'Get YouTube video metadata (title, views, description, etc.)',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const videoId = parseVideoId(kwargs.url);
        await prepareYoutubeApiPage(page);
        const data = await page.evaluate(`
      (async () => {
        const extractJsonAssignmentFromHtml = ${extractJsonAssignmentFromHtml.toString()};

        const watchResp = await fetch('/watch?v=' + encodeURIComponent(${JSON.stringify(videoId)}), {
          credentials: 'include',
        });
        if (!watchResp.ok) return { error: 'Watch HTML returned HTTP ' + watchResp.status };

        const html = await watchResp.text();
        const player = extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse');
        const yt = extractJsonAssignmentFromHtml(html, 'ytInitialData');
        if (!player) return { error: 'ytInitialPlayerResponse not found in watch HTML' };

        const details = player.videoDetails || {};
        const microformat = player.microformat?.playerMicroformatRenderer || {};
        const contents = yt?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

        // Try to get full description from watch bootstrap data
        let fullDescription = details.shortDescription || '';
        try {
          if (contents) {
            for (const c of contents) {
              const desc = c.videoSecondaryInfoRenderer?.attributedDescription?.content;
              if (desc) { fullDescription = desc; break; }
            }
          }
        } catch {}

        // Get like count if available
        let likes = '';
        try {
          if (contents) {
            for (const c of contents) {
              const buttons = c.videoPrimaryInfoRenderer?.videoActions
                ?.menuRenderer?.topLevelButtons;
              if (buttons) {
                for (const b of buttons) {
                  const toggle = b.segmentedLikeDislikeButtonViewModel
                    ?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel
                    ?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                  if (toggle?.title) { likes = toggle.title; break; }
                }
              }
            }
          }
        } catch {}

        // Get publish date
        const publishDate = microformat.publishDate
          || microformat.uploadDate
          || details.publishDate || '';

        // Get category
        const category = microformat.category || '';

        // Get channel subscriber count if available
        let subscribers = '';
        try {
          if (contents) {
            for (const c of contents) {
              const owner = c.videoSecondaryInfoRenderer?.owner
                ?.videoOwnerRenderer?.subscriberCountText?.simpleText;
              if (owner) { subscribers = owner; break; }
            }
          }
        } catch {}

        // 播放门禁信号：会员专享（channel membership）/ 付费点播等视频 metadata 照常
        // 可见，但视频流拿不到——playabilityStatus.status != 'OK'。reason 文本是本地化
        // 的（中文 cookie 下是中文），所以 membersOnly 用 watch HTML 里 locale 无关的
        // BADGE_STYLE_TYPE_MEMBERS_ONLY 徽标枚举判定，下游不要去 parse reason。
        const ps = player.playabilityStatus || {};
        const membersOnly = html.indexOf('BADGE_STYLE_TYPE_MEMBERS_ONLY') !== -1;

        return {
          title: details.title || '',
          channel: details.author || '',
          channelId: details.channelId || '',
          videoId: details.videoId || '',
          views: details.viewCount || '',
          likes,
          subscribers,
          duration: details.lengthSeconds ? details.lengthSeconds + 's' : '',
          publishDate,
          category,
          description: fullDescription,
          keywords: (details.keywords || []).join(', '),
          isLive: details.isLiveContent || false,
          thumbnail: details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || '',
          playabilityStatus: ps.status || '',
          playabilityReason: ps.reason || '',
          membersOnly,
        };
      })()
    `);
        const payload = requireVideoPayload(data);
        // Return as field/value pairs for table display
        return Object.entries(payload).map(([field, value]) => ({
            field,
            value: String(value),
        }));
    },
});
