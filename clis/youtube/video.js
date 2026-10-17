/**
 * YouTube video metadata — fetch watch HTML and parse bootstrap data without opening the watch UI.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractJsonAssignmentFromHtml, FETCH_BROWSE_FN, parseVideoId, prepareYoutubeApiPage } from './utils.js';
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
        ${FETCH_BROWSE_FN}

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

        // Get channel subscriber count + channel avatar if available.
        // Both live on the same videoOwnerRenderer node; thumbnails are
        // ordered smallest-first, so the last one is the largest.
        //
        // The node's position moves between watch-page variants, so scan the whole
        // primary column instead of only its top-level entries. contents holds the
        // primary column only — recommendations (secondaryResults) are a sibling of
        // it, so a recursive walk here cannot pick up another video's owner.
        let subscribers = '';
        let channelAvatar = '';
        try {
          const owners = [];
          const collectOwners = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 12) return;
            if (Array.isArray(node)) {
              for (const child of node) collectOwners(child, depth + 1);
              return;
            }
            if (node.videoOwnerRenderer) owners.push(node.videoOwnerRenderer);
            for (const child of Object.values(node)) collectOwners(child, depth + 1);
          };
          collectOwners(contents, 0);
          for (const ownerRenderer of owners) {
            const subs = ownerRenderer.subscriberCountText?.simpleText;
            if (subs && !subscribers) subscribers = subs;
            const avatar = ownerRenderer.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            if (avatar && !channelAvatar) channelAvatar = avatar;
            if (subscribers && channelAvatar) break;
          }
        } catch {}

        // Fallback: some watch-page variants ship no videoOwnerRenderer at all
        // (observed on ~80% of watch pages in one sample). videoDetails.channelId
        // is always there, so ask the channel's own browse response for the avatar.
        // One extra InnerTube call, and only on the pages that need it.
        if (!channelAvatar && details.channelId) {
          try {
            const cfg = window.ytcfg?.data_ || {};
            const apiKey = cfg.INNERTUBE_API_KEY;
            const context = cfg.INNERTUBE_CONTEXT;
            if (apiKey && context) {
              const channelData = await fetchBrowse(apiKey, { context, browseId: details.channelId });
              const metadata = channelData?.metadata?.channelMetadataRenderer;
              channelAvatar = metadata?.avatar?.thumbnails?.slice(-1)?.[0]?.url || '';
              // Same header shape youtube channel reads the subscriber line from.
              if (!subscribers) {
                const header = channelData?.header?.pageHeaderRenderer
                  || channelData?.header?.c4TabbedHeaderRenderer || {};
                const rows = header.content?.pageHeaderViewModel?.metadata
                  ?.contentMetadataViewModel?.metadataRows || [];
                for (const row of rows) {
                  for (const part of (row.metadataParts || [])) {
                    const text = part.text?.content || '';
                    if (text.includes('subscriber')) subscribers = text;
                  }
                }
                if (!subscribers && header.subscriberCountText?.simpleText) {
                  subscribers = header.subscriberCountText.simpleText;
                }
              }
            }
          } catch {}
        }

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
          channelAvatar,
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
