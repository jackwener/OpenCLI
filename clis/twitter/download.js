/**
 * Twitter/X download — download images and videos from tweets.
 *
 * Usage:
 *   opencli twitter download elonmusk --limit 10 --output ./twitter
 *   opencli twitter download --tweet-url https://x.com/xxx/status/123 --output ./twitter
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
cli({
    site: 'twitter',
    name: 'download',
    access: 'read',
    description: 'Download Twitter/X media (images and videos). Provide either <username> to scan a profile\'s media tab, or --tweet-url to download a single tweet.',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    siteSession: 'persistent',
    args: [
        { name: 'username', positional: true, help: 'Twitter username (with or without @) to scan their /media tab. Either <username> or --tweet-url is required.' },
        { name: 'tweet-url', help: 'Single tweet URL to download. Use this OR <username>, not both required at once.' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum number of media items to download when scanning a profile (default 10). Ignored when --tweet-url is used.' },
        { name: 'output', default: './twitter-downloads', help: 'Output directory (default ./twitter-downloads). A per-source subdir is created inside.' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const username = kwargs.username;
        const tweetUrl = kwargs['tweet-url'];
        const limit = kwargs.limit;
        const output = kwargs.output;
        if (!username && !tweetUrl) {
            return [{
                    index: 0,
                    type: '-',
                    status: 'failed',
                    size: 'Must provide a username or --tweet-url',
                }];
        }
        // Navigate to the appropriate page
        if (tweetUrl) {
            await page.goto(tweetUrl);
        }
        else {
            await page.goto(`https://x.com/${username}/media`);
        }
        await page.wait(3);
        // Scroll to load more content
        if (!tweetUrl) {
            await page.autoScroll({ times: Math.ceil(limit / 5) });
        }
        // Extract media URLs
        const data = await page.evaluate(`
      (() => {
        const media = [];

        // Find images (high quality)
        document.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach(img => {
          let src = img.src || '';
          // Get large version
          src = src.replace(/&name=\\w+$/, '&name=large');
          src = src.replace(/\\?format=/, '?format=');
          if (!src.includes('&name=')) {
            src = src + '&name=large';
          }
          media.push({ type: 'image', url: src });
        });

        // Find videos
        document.querySelectorAll('video').forEach(video => {
          const src = video.src || '';
          if (src) {
            media.push({ type: 'video', url: src, poster: video.poster || '' });
          }
        });

        // Find video tweets (for yt-dlp)
        document.querySelectorAll('[data-testid="videoPlayer"]').forEach(player => {
          const tweetLink = player.closest('article')?.querySelector('a[href*="/status/"]');
          const href = tweetLink?.getAttribute('href') || '';
          if (href) {
            const tweetUrl = 'https://x.com' + href;
            media.push({ type: 'video-tweet', url: tweetUrl });
          }
        });

        return media;
      })()
    `);
        if (!data || data.length === 0) {
            return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
        }
        // Extract cookies
        const browserCookies = await page.getCookies({ domain: 'x.com' });
        // Deduplicate media
        const seen = new Set();
        const uniqueMedia = data.filter((m) => {
            if (seen.has(m.url))
                return false;
            seen.add(m.url);
            return true;
        }).slice(0, limit);
        const subdir = tweetUrl ? 'tweets' : (username || 'media');
        return downloadMedia(uniqueMedia, {
            output,
            subdir,
            cookies: formatCookieHeader(browserCookies),
            browserCookies,
            filenamePrefix: username || 'tweet',
            ytdlpExtraArgs: ['--merge-output-format', 'mp4'],
        });
    },
});
