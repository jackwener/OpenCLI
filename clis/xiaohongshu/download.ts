/**
 * Xiaohongshu download — download images and videos from a note.
 *
 * Usage:
 *   opencli xiaohongshu download <note-id-or-url> --output ./xhs
 *
 * Accepts a bare note ID, a full xiaohongshu.com URL (with xsec_token),
 * or a short link (http://xhslink.com/...).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { buildNoteUrl, parseNoteId } from './note-helpers.js';

cli({
  site: 'xiaohongshu',
  name: 'download',
  description: '下载小红书笔记中的图片和视频',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', positional: true, required: true, help: 'Note ID, full URL, or short link' },
    { name: 'output', default: './xiaohongshu-downloads', help: 'Output directory' },
  ],
  columns: ['index', 'type', 'status', 'size'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['note-id']);
    const output = kwargs.output;
    const noteId = parseNoteId(rawInput);

    await page.goto(buildNoteUrl(rawInput));

    // Extract note info and media URLs
    const data = await page.evaluate(`
      (() => {
        const result = {
          noteId: '${noteId}',
          title: '',
          author: '',
          media: []
        };
        const seenMedia = new Set();
        const pushMedia = (type, url) => {
          if (!url) return;
          const key = type + ':' + url;
          if (seenMedia.has(key)) return;
          seenMedia.add(key);
          result.media.push({ type, url });
        };
        const locationMatch = (location.pathname || '').match(/\\/(?:explore|note|search_result|discovery\\/item)\\/([a-f0-9]+)/i);
        if (locationMatch) {
          result.noteId = locationMatch[1];
        }

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
          '#noteContainer .media-container img[src*="xhscdn"]',
          'img[src*="ci.xiaohongshu.com"]'
        ];

        const imageUrls = new Set();
        for (const selector of imageSelectors) {
          document.querySelectorAll(selector).forEach(img => {
            let src = img.src || img.getAttribute('data-src') || '';
            if (src && (src.includes('xhscdn') || src.includes('xiaohongshu'))) {
              src = src.split('?')[0];
              src = src.replace(/\\/imageView\\d+\\/\\d+\\/w\\/\\d+/, '');
              imageUrls.add(src);
            }
          });
        }

        // Get video — prefer real URL from page state over blob: URLs

        // Method 1: Extract from __INITIAL_STATE__ (SSR hydration data)
        try {
          const state = window.__INITIAL_STATE__;
          if (state) {
            const noteData = state.note?.noteDetailMap || state.note?.note || {};
            for (const key of Object.keys(noteData)) {
              const note = noteData[key]?.note || noteData[key];
              const video = note?.video;
              if (video) {
                const vUrl = video.url || video.originVideoKey || video.consumer?.originVideoKey;
                if (vUrl) {
                  const fullUrl = vUrl.startsWith('http') ? vUrl : 'https://sns-video-bd.xhscdn.com/' + vUrl;
                  pushMedia('video', fullUrl);
                }
                const streams = video.media?.stream?.h264 || [];
                for (const stream of streams) {
                  if (stream.masterUrl) pushMedia('video', stream.masterUrl);
                }
              }
            }
          }
        } catch(e) {}

        // Method 2: Extract video URLs from inline script JSON
        if (result.media.filter(m => m.type === 'video').length === 0) {
          try {
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              const text = s.textContent || '';
              const videoMatches = text.match(/https?:\\/\\/sns-video[^"'\\s]+\\.mp4[^"'\\s]*/g)
                || text.match(/https?:\\/\\/[^"'\\s]*xhscdn[^"'\\s]*\\.mp4[^"'\\s]*/g);
              if (videoMatches) {
                videoMatches.forEach(url => {
                  pushMedia('video', url.replace(/\\\\u002F/g, '/'));
                });
              }
            }
          } catch(e) {}
        }

        // Method 3: Fallback to DOM video elements, skip blob: URLs
        if (result.media.filter(m => m.type === 'video').length === 0) {
          const videoSelectors = [
            'video source',
            'video[src]',
            '.player video',
            '.video-player video'
          ];
          for (const selector of videoSelectors) {
            document.querySelectorAll(selector).forEach(v => {
              const src = v.src || v.getAttribute('src') || '';
              if (src && !src.startsWith('blob:')) {
                pushMedia('video', src);
              }
            });
          }
        }

        // Add images to media
        imageUrls.forEach(url => {
          pushMedia('image', url);
        });

        return result;
      })()
    `);

    if (!data || !data.media || data.media.length === 0) {
      return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
    }

    // Extract cookies for authenticated downloads
    const cookies = formatCookieHeader(await page.getCookies({ domain: 'xiaohongshu.com' }));
    const resolvedNoteId = typeof data.noteId === 'string' && data.noteId.trim()
      ? data.noteId.trim()
      : noteId;

    return downloadMedia(data.media, {
      output,
      subdir: resolvedNoteId,
      cookies,
      filenamePrefix: resolvedNoteId,
      timeout: 60000,
    });
  },
});
