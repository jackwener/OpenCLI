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
import { CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

        // Get images: prefer canonical carousel order from __INITIAL_STATE__
        // so the saved order matches what the user sees on the platform (#1514).
        // DOM extraction is used only as a fallback because multiple selectors,
        // hidden / duplicated / preloaded slides, and lazy rendering can reorder
        // the discovered nodes away from the platform's display order.

        const normalizeImageUrl = (raw) => {
          if (!raw || typeof raw !== 'string') return '';
          let src = raw.split('?')[0];
          src = src.replace(/\\/imageView\\d+\\/\\d+\\/w\\/\\d+/, '');
          return src;
        };
        const orderedImageUrls = [];
        const seenImageUrls = new Set();
        const pushImage = (url) => {
          if (!url || seenImageUrls.has(url)) return;
          seenImageUrls.add(url);
          orderedImageUrls.push(url);
        };

        const getStructuredNotes = () => {
          const state = window.__INITIAL_STATE__;
          const noteData = state?.note?.noteDetailMap || state?.note?.note || {};
          if (!noteData || typeof noteData !== 'object') return [];
          const currentIds = [...new Set([result.noteId, '${noteId}'].filter(Boolean))];
          const notes = [];
          for (const id of currentIds) {
            const entry = noteData[id];
            const note = entry?.note || entry;
            if (note && typeof note === 'object') notes.push(note);
          }
          // Compatibility fallback for legacy single-note stores. Do not use this
          // when keyed detail maps contain multiple notes, or carousel order can
          // be polluted by preloaded/previous note entries.
          const keys = Object.keys(noteData);
          if (notes.length === 0 && keys.length === 1) {
            const entry = noteData[keys[0]];
            const note = entry?.note || entry;
            if (note && typeof note === 'object') notes.push(note);
          }
          return notes;
        };

        // Method 1: walk __INITIAL_STATE__.note.noteDetailMap[id].note.imageList
        // in array order. Each entry exposes urlDefault as the canonical CDN URL.
        let imageInitialStateUsed = false;
        try {
          for (const note of getStructuredNotes()) {
            const list = Array.isArray(note?.imageList) ? note.imageList : [];
            for (const item of list) {
              const candidate = item?.urlDefault || item?.urlPre || item?.url
                || item?.infoList?.find(i => i?.imageScene === 'WB_DFT')?.url
                || item?.infoList?.[0]?.url
                || '';
              const src = normalizeImageUrl(candidate);
              if (src && (src.includes('xhscdn') || src.includes('xiaohongshu') || src.includes('rednote'))) {
                pushImage(src);
                imageInitialStateUsed = true;
              }
            }
          }
        } catch(e) {}

        // Method 2: fallback to DOM scraping when the structured state is missing
        // (e.g. preview pages without full SSR hydration). Order may differ from
        // the carousel; surface it anyway rather than returning zero images.
        if (!imageInitialStateUsed) {
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
              const raw = img.src || img.getAttribute('data-src') || '';
              const src = normalizeImageUrl(raw);
              if (src && (src.includes('xhscdn') || src.includes('xiaohongshu') || src.includes('rednote'))) {
                pushImage(src);
              }
            });
          }
        }

        // Get video — prefer real URL from page state over blob: URLs

        // Method 1: Extract from __INITIAL_STATE__ (SSR hydration data)
        try {
          for (const note of getStructuredNotes()) {
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

        // Preserve the pre-existing media type order (videos first, then images)
        // while keeping image carousel order stable within the image batch.
        orderedImageUrls.forEach(url => pushMedia('image', url));

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
        if (!data || typeof data !== 'object' || !Array.isArray(data.media)) {
            throw new CommandExecutionError('Xiaohongshu media extraction returned malformed payload.');
        }
        if (data.media.length === 0) {
            throw new EmptyResultError('xiaohongshu download', 'No downloadable media found on this note.');
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
