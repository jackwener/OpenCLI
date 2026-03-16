/**
 * Bilibili download — download videos using yt-dlp.
 *
 * Usage:
 *   opencli bilibili download --bvid BV1xxx --output ./bilibili
 *
 * Requirements:
 *   - yt-dlp must be installed: pip install yt-dlp
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import {
  ytdlpDownload,
  checkYtdlp,
  sanitizeFilename,
  getTempDir,
  exportCookiesToNetscape,
} from '../../download/index.js';
import { DownloadProgressTracker, formatBytes } from '../../download/progress.js';

cli({
  site: 'bilibili',
  name: 'download',
  description: '下载B站视频（需要 yt-dlp）',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'bvid', required: true, help: 'Video BV ID (e.g., BV1xxx)' },
    { name: 'output', default: './bilibili-downloads', help: 'Output directory' },
    { name: 'quality', default: 'best', help: 'Video quality (best, 1080p, 720p, 480p)' },
  ],
  columns: ['bvid', 'title', 'status', 'size'],
  func: async (page, kwargs) => {
    const bvid = kwargs.bvid;
    const output = kwargs.output;
    const quality = kwargs.quality;

    // Check yt-dlp availability
    if (!checkYtdlp()) {
      return [{
        bvid,
        title: '-',
        status: 'failed',
        size: 'yt-dlp not installed. Run: pip install yt-dlp',
      }];
    }

    // Navigate to video page to get title and cookies
    await page.goto(`https://www.bilibili.com/video/${bvid}`);
    await page.wait(3);

    // Extract video info
    const data = await page.evaluate(`
      (() => {
        const title = document.querySelector('h1.video-title, .video-title')?.textContent?.trim() || 'video';
        const author = document.querySelector('.up-name, .username')?.textContent?.trim() || 'unknown';
        return { title, author };
      })()
    `);

    const title = sanitizeFilename(data?.title || 'video');

    // Extract cookies for authenticated downloads
    const cookieString = await page.evaluate(`(() => document.cookie)()`);

    // Create output directory
    fs.mkdirSync(output, { recursive: true });

    // Export cookies to Netscape format for yt-dlp
    let cookiesFile: string | undefined;
    if (typeof cookieString === 'string' && cookieString) {
      const tempDir = getTempDir();
      fs.mkdirSync(tempDir, { recursive: true });
      cookiesFile = path.join(tempDir, `bilibili_cookies_${Date.now()}.txt`);

      const cookies = cookieString.split(';').map((c) => {
        const [name, ...rest] = c.trim().split('=');
        return {
          name: name || '',
          value: rest.join('=') || '',
          domain: '.bilibili.com',
          path: '/',
          secure: true,
          httpOnly: false,
        };
      }).filter((c) => c.name);

      exportCookiesToNetscape(cookies, cookiesFile);
    }

    // Build yt-dlp format string based on quality
    let format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080p') {
      format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]';
    } else if (quality === '720p') {
      format = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]';
    } else if (quality === '480p') {
      format = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]';
    }

    const destPath = path.join(output, `${bvid}_${title}.mp4`);

    const tracker = new DownloadProgressTracker(1, true);
    const progressBar = tracker.onFileStart(`${bvid}.mp4`, 0);

    try {
      const result = await ytdlpDownload(
        `https://www.bilibili.com/video/${bvid}`,
        destPath,
        {
          cookiesFile,
          format,
          extraArgs: [
            '--merge-output-format', 'mp4',
            '--embed-thumbnail',
          ],
          onProgress: (percent) => {
            if (progressBar) progressBar.update(percent, 100);
          },
        },
      );

      if (progressBar) {
        progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
      }

      tracker.onFileComplete(result.success);
      tracker.finish();

      // Cleanup cookies file
      if (cookiesFile && fs.existsSync(cookiesFile)) {
        fs.unlinkSync(cookiesFile);
      }

      return [{
        bvid,
        title: data?.title || 'video',
        status: result.success ? 'success' : 'failed',
        size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
      }];
    } catch (err: any) {
      if (progressBar) progressBar.fail(err.message);
      tracker.onFileComplete(false);
      tracker.finish();

      // Cleanup cookies file
      if (cookiesFile && fs.existsSync(cookiesFile)) {
        fs.unlinkSync(cookiesFile);
      }

      return [{
        bvid,
        title: data?.title || 'video',
        status: 'failed',
        size: err.message,
      }];
    }
  },
});
