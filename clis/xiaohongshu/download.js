/**
 * Xiaohongshu download — download images and videos from a note.
 *
 * Usage:
 *   opencli xiaohongshu download <signed-note-url-or-shortlink> --output ./xhs
 *
 * Accepts a full xiaohongshu.com URL with xsec_token or an xhslink short link.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { CliError } from '@jackwener/opencli/errors';
import { buildNoteUrl, parseNoteId } from './note-helpers.js';
/**
 * Build the media-extraction IIFE. The note id is interpolated as a default
 * since the IIFE may also resolve it from `location.pathname`. The CDN
 * substring allowlist includes `rednote` so the rednote adapter can reuse
 * this script unchanged — image / video URLs on both sites are served from
 * the same xhscdn family per #1136.
 */
export function buildDownloadExtractJs(noteId) {
    return `
      (() => {
        const bodyText = document.body?.innerText || '';
        const result = {
          noteId: '${noteId}',
          pageUrl: location.href,
          securityBlock: /安全限制|访问链接异常/.test(bodyText)
            || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href),
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
        const cleanImageUrl = (value) => {
          if (typeof value !== 'string') return '';
          let src = value.trim();
          if (!src) return '';
          if (!(src.includes('xhscdn') || src.includes('xiaohongshu') || src.includes('rednote'))) return '';
          src = src.split('?')[0];
          return src.replace(/\\/imageView\\d+\\/\\d+\\/w\\/\\d+/, '');
        };
        const imageUrls = new Set();
        const addImageUrl = (value) => {
          const src = cleanImageUrl(value);
          if (src) imageUrls.add(src);
        };
        const getImageUrl = (value) => {
          if (!value) return '';
          const direct = cleanImageUrl(value);
          if (direct) return direct;
          if (typeof value !== 'object') return '';
          const candidates = [
            value.urlDefault, value.url_default,
            value.urlPre, value.url_pre,
            value.url, value.src,
            value.originUrl, value.origin_url,
            value.masterUrl, value.master_url,
          ];
          for (const candidate of candidates) {
            const src = cleanImageUrl(candidate);
            if (src) return src;
          }
          const nestedLists = [value.infoList, value.info_list, value.urlList, value.url_list].filter(Array.isArray);
          for (const list of nestedLists) {
            for (const item of list) {
              const src = getImageUrl(item);
              if (src) return src;
            }
          }
          return '';
        };
        const addImagesFromList = (list) => {
          if (!Array.isArray(list)) return 0;
          let added = 0;
          for (const item of list) {
            const src = getImageUrl(item);
            if (!src) continue;
            const before = imageUrls.size;
            imageUrls.add(src);
            if (imageUrls.size > before) added++;
          }
          return added;
        };
        const noteMatches = (note, key) => {
          const ids = [
            key,
            note?.noteId, note?.note_id, note?.id,
            note?.noteCard?.noteId, note?.noteCard?.note_id,
            note?.note_card?.noteId, note?.note_card?.note_id,
          ].filter(Boolean).map(String);
          return !result.noteId || ids.includes(result.noteId);
        };
        const addImagesFromNote = (note) => {
          if (!note || typeof note !== 'object') return 0;
          const imageLists = [
            note.imageList, note.image_list,
            note.images, note.image,
            note.image?.imageList, note.image?.image_list,
            note.image?.images, note.image?.list,
            note.noteCard?.imageList, note.noteCard?.image_list,
            note.note_card?.imageList, note.note_card?.image_list,
          ];
          for (const list of imageLists) {
            const added = Array.isArray(list) ? addImagesFromList(list) : 0;
            if (added > 0) return added;
          }
          return 0;
        };
        const locationMatch = (location.pathname || '').match(/\\/(?:explore|note|search_result|discovery\\/item)\\/([a-f0-9]+)|\\/user\\/profile\\/[^/?#]+\\/([a-f0-9]+)/i);
        if (locationMatch) {
          result.noteId = locationMatch[1] || locationMatch[2];
        }

        // Get title
        const titleEl = document.querySelector('.title, #detail-title, .note-content .title');
        result.title = titleEl?.textContent?.trim() || 'untitled';

        // Get author
        const authorEl = document.querySelector('.username, .author-name, .name');
        result.author = authorEl?.textContent?.trim() || 'unknown';

        // Prefer page state image arrays because DOM carousel nodes can be
        // duplicated, hidden, or preloaded out of display order.
        try {
          const state = window.__INITIAL_STATE__;
          const noteData = state?.note?.noteDetailMap || state?.note?.note || {};
          const entries = [];
          if (Array.isArray(noteData)) {
            noteData.forEach((value, index) => entries.push([String(index), value]));
          } else if (noteData && typeof noteData === 'object') {
            Object.keys(noteData).forEach(key => entries.push([key, noteData[key]]));
          }
          const notes = entries
            .map(([key, value]) => [key, value?.note || value?.noteCard || value?.note_card || value])
            .filter(([, note]) => note && typeof note === 'object');
          const matchingNotes = notes.filter(([key, note]) => noteMatches(note, key));
          const candidates = matchingNotes.length > 0 ? matchingNotes : (notes.length === 1 ? notes : []);
          for (const [, note] of candidates) {
            if (addImagesFromNote(note) > 0) break;
          }
        } catch(e) {}

        // Fall back to DOM selectors when structured note media is unavailable.
        if (imageUrls.size === 0) {
          const imageSelectors = [
            '.swiper-slide img',
            '.carousel-image img',
            '.note-slider img',
            '.note-image img',
            '.image-wrapper img',
            '#noteContainer .media-container img[src*="xhscdn"]',
            'img[src*="ci.xiaohongshu.com"]'
          ];
          for (const selector of imageSelectors) {
            document.querySelectorAll(selector).forEach(img => {
              addImageUrl(img.src || img.getAttribute('data-src') || '');
            });
          }
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
    `;
}
export const command = cli({
    site: 'xiaohongshu',
    name: 'download',
    access: 'read',
    description: '下载小红书笔记中的图片和视频',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', positional: true, required: true, help: 'Full Xiaohongshu note URL with xsec_token, or xhslink short link' },
        { name: 'output', default: './xiaohongshu-downloads', help: 'Output directory' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const rawInput = String(kwargs['note-id']);
        const output = kwargs.output;
        const noteId = parseNoteId(rawInput);
        await page.goto(buildNoteUrl(rawInput, { allowShortLink: true, commandName: 'xiaohongshu download' }));
        await page.wait({ time: 1 + Math.random() * 2 });
        const data = await page.evaluate(buildDownloadExtractJs(noteId));
        if (data?.securityBlock) {
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(rawInput)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
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
