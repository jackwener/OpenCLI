/**
 * YouTube video metadata — read ytInitialPlayerResponse + ytInitialData from video page.
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'youtube',
  name: 'video',
  description: 'Get YouTube video metadata (title, views, description, etc.)',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, help: 'YouTube video URL or video ID' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    // Normalize: accept full URL (watch, shorts, embed, live, youtu.be) or bare video ID
    let videoUrl = kwargs.url;
    if (!kwargs.url.startsWith('http')) {
      videoUrl = `https://www.youtube.com/watch?v=${kwargs.url}`;
    } else {
      try {
        const parsed = new URL(kwargs.url);
        const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
        if (pathMatch) {
          videoUrl = `https://www.youtube.com/watch?v=${pathMatch[2]}`;
        }
      } catch {}
    }

    await page.goto(videoUrl);
    await page.wait(3);

    const data = await page.evaluate(`
      (async () => {
        const player = window.ytInitialPlayerResponse;
        const yt = window.ytInitialData;
        if (!player) return { error: 'ytInitialPlayerResponse not found' };

        const details = player.videoDetails || {};
        const microformat = player.microformat?.playerMicroformatRenderer || {};

        // Try to get full description from ytInitialData
        let fullDescription = details.shortDescription || '';
        try {
          const secondary = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
          if (secondary) {
            for (const c of secondary) {
              const desc = c.videoSecondaryInfoRenderer?.attributedDescription?.content;
              if (desc) { fullDescription = desc; break; }
            }
          }
        } catch {}

        // Get like count if available
        let likes = '';
        try {
          const primary = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
          if (primary) {
            for (const c of primary) {
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
          const secondary = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
          if (secondary) {
            for (const c of secondary) {
              const owner = c.videoSecondaryInfoRenderer?.owner
                ?.videoOwnerRenderer?.subscriberCountText?.simpleText;
              if (owner) { subscribers = owner; break; }
            }
          }
        } catch {}

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
        };
      })()
    `);

    if (!data || typeof data !== 'object') throw new Error('Failed to extract video metadata from page');
    if (data.error) throw new Error(data.error);

    // Return as field/value pairs for table display
    return Object.entries(data).map(([field, value]) => ({
      field,
      value: String(value),
    }));
  },
});
