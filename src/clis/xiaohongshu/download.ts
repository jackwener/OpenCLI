/**
 * Xiaohongshu download — download images and videos from a note.
 *
 * Usage:
 *   opencli xiaohongshu download --note-id abc123 --output ./xhs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import {
  httpDownload,
  sanitizeFilename,
  detectContentType,
} from '../../download/index.js';
import { DownloadProgressTracker, formatBytes } from '../../download/progress.js';

cli({
  site: 'xiaohongshu',
  name: 'download',
  description: '下载小红书笔记中的图片和视频',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', required: true, help: 'Note ID (from URL)' },
    { name: 'output', default: './xiaohongshu-downloads', help: 'Output directory' },
  ],
  columns: ['index', 'type', 'status', 'size'],
  func: async (page, kwargs) => {
    const noteId = kwargs['note-id'];
    const output = kwargs.output;

    // Navigate to note page
    await page.goto(`https://www.xiaohongshu.com/explore/${noteId}`);
    await page.wait(3);

    // Extract note info and media URLs
    const data = await page.evaluate(`
      (() => {
        const result = {
          noteId: '${noteId}',
          title: '',
          author: '',
          media: []
        };

        // Get title
        const titleEl = document.querySelector('.title, #detail-title, .note-content .title');
        result.title = titleEl?.textContent?.trim() || 'untitled';

        // Get author
        const authorEl = document.querySelector('.username, .author-name, .name');
        result.author = authorEl?.textContent?.trim() || 'unknown';

        // Get images - try multiple selectors
        const imageSelectors = [
          '.swiper-slide img',
          '.carousel-image img',
          '.note-slider img',
          '.note-image img',
          '.image-wrapper img',
          '#noteContainer img[src*="xhscdn"]',
          'img[src*="ci.xiaohongshu.com"]'
        ];

        const imageUrls = new Set();
        for (const selector of imageSelectors) {
          document.querySelectorAll(selector).forEach(img => {
            let src = img.src || img.getAttribute('data-src') || '';
            if (src && (src.includes('xhscdn') || src.includes('xiaohongshu'))) {
              // Convert to high quality URL (remove resize parameters)
              src = src.split('?')[0];
              // Try to get original size
              src = src.replace(/\\/imageView\\d+\\/\\d+\\/w\\/\\d+/, '');
              imageUrls.add(src);
            }
          });
        }

        // Get video if exists
        const videoSelectors = [
          'video source',
          'video[src]',
          '.player video',
          '.video-player video'
        ];

        for (const selector of videoSelectors) {
          document.querySelectorAll(selector).forEach(v => {
            const src = v.src || v.getAttribute('src') || '';
            if (src) {
              result.media.push({
                type: 'video',
                url: src
              });
            }
          });
        }

        // Add images to media
        imageUrls.forEach(url => {
          result.media.push({
            type: 'image',
            url: url
          });
        });

        return result;
      })()
    `);

    if (!data || !data.media || data.media.length === 0) {
      return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
    }

    // Extract cookies for authenticated downloads
    const cookies = await page.evaluate(`(() => document.cookie)()`);

    // Create output directory
    const outputDir = path.join(output, noteId);
    fs.mkdirSync(outputDir, { recursive: true });

    // Download all media files
    const tracker = new DownloadProgressTracker(data.media.length, true);
    const results: any[] = [];

    for (let i = 0; i < data.media.length; i++) {
      const media = data.media[i];
      const ext = media.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${noteId}_${i + 1}.${ext}`;
      const destPath = path.join(outputDir, filename);

      const progressBar = tracker.onFileStart(filename, i);

      try {
        const result = await httpDownload(media.url, destPath, {
          cookies: typeof cookies === 'string' ? cookies : '',
          timeout: 60000,
          onProgress: (received, total) => {
            if (progressBar) progressBar.update(received, total);
          },
        });

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }

        tracker.onFileComplete(result.success);

        results.push({
          index: i + 1,
          type: media.type,
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

    return results;
  },
});
