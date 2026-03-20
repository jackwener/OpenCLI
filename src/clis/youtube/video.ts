/**
 * YouTube video metadata — read ytInitialPlayerResponse + ytInitialData from video page.
 */
import { cli, Strategy } from '../../registry.js';
import { parseVideoId } from './utils.js';

cli({
  site: 'youtube',
  name: 'video',
  description: 'Get YouTube video metadata (title, views, description, etc.)',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const videoId = parseVideoId(kwargs.url);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
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
          const contents = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
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
          const contents = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
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
          const contents = yt?.contents?.twoColumnWatchNextResults
            ?.results?.results?.contents;
          if (contents) {
            for (const c of contents) {
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
