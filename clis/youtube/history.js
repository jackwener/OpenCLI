/**
 * YouTube history — watch history via InnerTube browse API (FEhistory).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
    site: 'youtube',
    name: 'history',
    description: 'Get YouTube watch history',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Max videos to return (default 30, max 200)' },
    ],
    columns: ['rank', 'title', 'channel', 'views', 'duration', 'url'],
    func: async (page, kwargs) => {
        const limit = Math.min(kwargs.limit || 30, 200);
        await page.goto('https://www.youtube.com/feed/history');
        await page.wait(3);
        await page.autoScroll({ times: Math.min(Math.max(Math.ceil(limit / 20), 1), 8), delayMs: 1200 });
        const data = await page.evaluate(`
      (async () => {
        const limit = ${limit};

        const videos = [];
        const seen = new Set();
        const root = document.querySelector('ytd-two-column-browse-results-renderer #primary ytd-section-list-renderer');
        if (!root) return { error: 'YouTube history list not found' };

        function text(el) {
          return (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        }

        function push(entry) {
          if (!entry?.url || seen.has(entry.url) || videos.length >= limit) return;
          seen.add(entry.url);
          videos.push({ rank: videos.length + 1, ...entry });
        }

        for (const section of root.querySelectorAll('ytd-item-section-renderer')) {
          if (videos.length >= limit) break;

          for (const renderer of section.querySelectorAll('yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer')) {
            if (videos.length >= limit) break;
            const link = renderer.querySelector('a[href^="/watch?v="]');
            const href = link?.getAttribute('href') || '';
            if (!href) continue;
            const title =
              link?.getAttribute('title')
              || text(renderer.querySelector('#video-title'))
              || text(renderer.querySelector('h3 a'))
              || text(renderer.querySelector('h3'))
              || text(link);
            const channel =
              text(renderer.querySelector('#channel-name a'))
              || text(renderer.querySelector('[aria-label^="前往频道："]'))
              || text(renderer.querySelector('[aria-label^="Go to channel:"]'))
              || text(renderer.querySelector('ytd-channel-name'))
              || text(renderer.querySelector('#metadata #byline-container'))
              || '';
            const metadata = Array.from(renderer.querySelectorAll('#metadata-line span, #metadata span, .metadata span'))
              .map(node => text(node))
              .filter(Boolean);
            const lockupMetadata = Array.from(renderer.querySelectorAll('yt-content-metadata-view-model span, yt-lockup-metadata-view-model span'))
              .map(node => text(node))
              .filter(Boolean);
            const combinedMetadata = (metadata.length ? metadata : lockupMetadata)
              .filter(value => value && value !== title && value !== '•');
            const inferredChannel = channel || combinedMetadata.find(value => !/观看|views|前|前に|ago|次观看|次查看|stream/i.test(value)) || '';
            const inferredViews = combinedMetadata.find(value => /观看|views/i.test(value)) || '';
            const inferredPublished = combinedMetadata.find(value => value !== inferredChannel && value !== inferredViews) || '';
            const duration =
              text(renderer.querySelector('ytd-thumbnail-overlay-time-status-renderer'))
              || text(renderer.querySelector('yt-thumbnail-badge-view-model'))
              || text(renderer.querySelector('badge-shape'))
              || '';
            push({
              title,
              channel: inferredChannel,
              views: inferredViews,
              duration,
              published: inferredPublished,
              url: href.startsWith('http') ? href : 'https://www.youtube.com' + href,
            });
          }

          for (const shortLink of section.querySelectorAll('a[href^="/shorts/"]')) {
            if (videos.length >= limit) break;
            const card = shortLink.closest('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model, ytd-reel-item-renderer') || shortLink.parentElement;
            const href = shortLink.getAttribute('href') || '';
            if (!href) continue;
            const title = shortLink.getAttribute('title') || text(card?.querySelector('h3')) || text(shortLink);
            const stats = Array.from(card?.querySelectorAll('span') || []).map(node => text(node)).filter(Boolean);
            push({
              title,
              channel: 'Shorts',
              views: stats.find(value => /观看|views/i.test(value)) || '',
              duration: 'SHORT',
              published: '',
              url: href.startsWith('http') ? href : 'https://www.youtube.com' + href,
            });
          }
        }

        return videos.length ? videos : { error: 'No watch history items found on youtube.com/feed/history' };
      })()
    `);
        if (!Array.isArray(data)) {
            const errMsg = data && typeof data === 'object' ? String(data.error || '') : '';
            throw new CommandExecutionError(errMsg || 'Failed to fetch watch history — make sure you are logged into YouTube');
        }
        if (data.length === 0) {
            throw new EmptyResultError('youtube history');
        }
        return data;
    },
});
