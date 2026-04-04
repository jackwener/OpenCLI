/**
 * Bilibili download — download videos using yt-dlp.
 *
 * Usage:
 *   opencli bilibili download --bvid BV1xxx --output ./bilibili
 *
 * Requirements:
 *   - yt-dlp must be installed: pip install yt-dlp
 */

import { cli, Strategy } from '../../registry.js';
import { checkYtdlp, sanitizeFilename } from '../../download/index.js';
import { downloadMedia } from '../../download/media-download.js';
import { resolveBvid } from './utils.js';

cli({
  site: 'bilibili',
  name: 'download',
  description: '下载B站视频（需要 yt-dlp）',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'bvid', required: true, positional: true, help: 'Video BV ID (e.g., BV1xxx)' },
    { name: 'output', default: './bilibili-downloads', help: 'Output directory' },
    { name: 'quality', default: 'best', help: 'Video quality (best, 1080p, 720p, 480p)' },
  ],
  columns: ['bvid', 'title', 'status', 'size'],
  func: async (page, kwargs) => {
    const bvid = await resolveBvid(kwargs.bvid);
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

    // Extract cookies for yt-dlp
    const browserCookies = await page.getCookies({ domain: 'bilibili.com' });

    // Build yt-dlp format string based on quality
    let format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    if (quality === '1080p') {
      format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]';
    } else if (quality === '720p') {
      format = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]';
    } else if (quality === '480p') {
      format = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]';
    }

    const videoUrl = `https://www.bilibili.com/video/${bvid}`;
    const filename = `${bvid}_${title}.mp4`;

    const results = await downloadMedia(
      [{ type: 'video-ytdlp', url: videoUrl, filename }],
      {
        output,
        browserCookies,
        filenamePrefix: bvid,
        ytdlpExtraArgs: ['-f', format, '--merge-output-format', 'mp4', '--embed-thumbnail'],
      },
    );

    // Map results to bilibili-specific columns
    const r = results[0] || { status: 'failed', size: '-' };
    return [{
      bvid,
      title: data?.title || 'video',
      status: r.status,
      size: r.size,
    }];
  },
});
