/**
 * Twitter/X download — download images and videos from tweets.
 *
 * Usage:
 *   opencli twitter download elonmusk --limit 10 --output ./twitter
 *   opencli twitter download --tweet-url https://x.com/xxx/status/123 --output ./twitter
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import {
  httpDownload,
  ytdlpDownload,
  checkYtdlp,
  sanitizeFilename,
  getTempDir,
  exportCookiesToNetscape,
  formatCookieHeader,
} from '../../download/index.js';
import { DownloadProgressTracker, formatBytes } from '../../download/progress.js';

cli({
  site: 'twitter',
  name: 'download',
  description: '下载 Twitter/X 媒体（图片和视频）',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', positional: true, help: 'Twitter username (downloads from media tab)' },
    { name: 'tweet-url', help: 'Single tweet URL to download' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of tweets to scan' },
    { name: 'output', default: './twitter-downloads', help: 'Output directory' },
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
    } else {
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
      return [{
        index: 0,
        type: '-',
        status: 'failed',
        size: 'No media found',
      }];
    }

    // Extract cookies
    const cookies = await page.getCookies({ domain: 'x.com' });
    const cookieString = formatCookieHeader(cookies);

    // Create output directory
    const outputDir = tweetUrl
      ? path.join(output, 'tweets')
      : path.join(output, username || 'media');
    fs.mkdirSync(outputDir, { recursive: true });

    // Export cookies for yt-dlp
    let cookiesFile: string | undefined;
    if (cookies.length > 0) {
      const tempDir = getTempDir();
      fs.mkdirSync(tempDir, { recursive: true });
      cookiesFile = path.join(tempDir, `twitter_cookies_${Date.now()}.txt`);
      exportCookiesToNetscape(cookies, cookiesFile);
    }

    // Deduplicate media
    const seen = new Set<string>();
    const uniqueMedia = data.filter((m: any) => {
      if (seen.has(m.url)) return false;
      seen.add(m.url);
      return true;
    }).slice(0, limit);

    const tracker = new DownloadProgressTracker(uniqueMedia.length, true);
    const results: any[] = [];

    for (let i = 0; i < uniqueMedia.length; i++) {
      const media = uniqueMedia[i];
      const ext = media.type === 'image' ? 'jpg' : 'mp4';
      const filename = `${username || 'tweet'}_${i + 1}.${ext}`;
      const destPath = path.join(outputDir, filename);

      const progressBar = tracker.onFileStart(filename, i);

      try {
        let result: { success: boolean; size: number; error?: string };

        if (media.type === 'video-tweet' && checkYtdlp()) {
          // Use yt-dlp for video tweets
          result = await ytdlpDownload(media.url, destPath, {
            cookiesFile,
            extraArgs: ['--merge-output-format', 'mp4'],
            onProgress: (percent) => {
              if (progressBar) progressBar.update(percent, 100);
            },
          });
        } else if (media.type === 'image') {
          // Direct HTTP download for images
          result = await httpDownload(media.url, destPath, {
            cookies: cookieString,
            timeout: 30000,
            onProgress: (received, total) => {
              if (progressBar) progressBar.update(received, total);
            },
          });
        } else {
          // Direct HTTP download for direct video URLs
          result = await httpDownload(media.url, destPath, {
            cookies: cookieString,
            timeout: 60000,
            onProgress: (received, total) => {
              if (progressBar) progressBar.update(received, total);
            },
          });
        }

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }

        tracker.onFileComplete(result.success);

        results.push({
          index: i + 1,
          type: media.type === 'video-tweet' ? 'video' : media.type,
          status: result.success ? 'success' : 'failed',
          size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
        });
      } catch (err: any) {
        if (progressBar) progressBar.fail(err.message);
        tracker.onFileComplete(false);

        results.push({
          index: i + 1,
          type: media.type,
          status: 'failed',
          size: err.message,
        });
      }
    }

    tracker.finish();

    // Cleanup cookies file
    if (cookiesFile && fs.existsSync(cookiesFile)) {
      fs.unlinkSync(cookiesFile);
    }

    return results;
  },
});
