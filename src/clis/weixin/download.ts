/**
 * WeChat article download — export WeChat Official Account articles to Markdown.
 *
 * Ported from jackwener/wechat-article-to-markdown (JS version) to OpenCLI adapter.
 *
 * Usage:
 *   opencli weixin download --url "https://mp.weixin.qq.com/s/xxx" --output ./weixin
 */

import { cli, Strategy } from '../../registry.js';
import { downloadArticle } from '../../download/article-download.js';

// ============================================================
// URL Normalization
// ============================================================

/**
 * Normalize a pasted WeChat article URL.
 */
export function normalizeWechatUrl(raw: string): string {
  let s = (raw || '').trim();
  if (!s) return s;

  // Strip wrapping quotes / angle brackets
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('<') && s.endsWith('>')) {
    s = s.slice(1, -1).trim();
  }

  // Remove backslash escapes before URL-significant characters
  s = s.replace(/\\+([:/&?=#%])/g, '$1');

  // Decode HTML entities
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  // Allow bare hostnames
  if (s.startsWith('mp.weixin.qq.com/') || s.startsWith('//mp.weixin.qq.com/')) {
    s = 'https://' + s.replace(/^\/+/, '');
  }

  // Force https for mp.weixin.qq.com
  try {
    const parsed = new URL(s);
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.toLowerCase() === 'mp.weixin.qq.com') {
      parsed.protocol = 'https:';
      s = parsed.toString();
    }
  } catch {
    // Ignore parse errors
  }

  return s;
}

// ============================================================
// CLI Registration
// ============================================================

cli({
  site: 'weixin',
  name: 'download',
  description: '下载微信公众号文章为 Markdown 格式',
  domain: 'mp.weixin.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', required: true, help: 'WeChat article URL (mp.weixin.qq.com/s/xxx)' },
    { name: 'output', default: './weixin-articles', help: 'Output directory' },
    { name: 'download-images', type: 'boolean', default: true, help: 'Download images locally' },
  ],
  columns: ['title', 'author', 'publish_time', 'status', 'size'],
  func: async (page, kwargs) => {
    const rawUrl = kwargs.url;
    const url = normalizeWechatUrl(rawUrl);

    if (!url.startsWith('https://mp.weixin.qq.com/')) {
      return [{ title: 'Error', author: '-', publish_time: '-', status: 'invalid URL', size: '-' }];
    }

    // Navigate and wait for content to load
    await page.goto(url);
    await page.wait(5);

    // Extract article data in browser context
    const data = await page.evaluate(`
      (() => {
        const result = {
          title: '',
          author: '',
          publishTime: '',
          contentHtml: '',
          codeBlocks: [],
          imageUrls: []
        };

        // Title: #activity-name
        const titleEl = document.querySelector('#activity-name');
        result.title = titleEl ? titleEl.textContent.trim() : '';

        // Author (WeChat Official Account name): #js_name
        const authorEl = document.querySelector('#js_name');
        result.author = authorEl ? authorEl.textContent.trim() : '';

        // Publish time: extract create_time from script tags
        const htmlStr = document.documentElement.innerHTML;
        let timeMatch = htmlStr.match(/create_time\\s*:\\s*JsDecode\\('([^']+)'\\)/);
        if (!timeMatch) timeMatch = htmlStr.match(/create_time\\s*:\\s*'(\\d+)'/);
        if (!timeMatch) timeMatch = htmlStr.match(/create_time\\s*[:=]\\s*["']?(\\d+)["']?/);
        if (timeMatch) {
          const ts = parseInt(timeMatch[1], 10);
          if (ts > 0) {
            const d = new Date(ts * 1000);
            const pad = n => String(n).padStart(2, '0');
            const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
            result.publishTime =
              utc8.getUTCFullYear() + '-' +
              pad(utc8.getUTCMonth() + 1) + '-' +
              pad(utc8.getUTCDate()) + ' ' +
              pad(utc8.getUTCHours()) + ':' +
              pad(utc8.getUTCMinutes()) + ':' +
              pad(utc8.getUTCSeconds());
          }
        }

        // Content processing
        const contentEl = document.querySelector('#js_content');
        if (!contentEl) return result;

        // Fix lazy-loaded images: data-src -> src
        contentEl.querySelectorAll('img').forEach(img => {
          const dataSrc = img.getAttribute('data-src');
          if (dataSrc) img.setAttribute('src', dataSrc);
        });

        // Extract code blocks with placeholder replacement
        const codeBlocks = [];
        contentEl.querySelectorAll('.code-snippet__fix').forEach(el => {
          el.querySelectorAll('.code-snippet__line-index').forEach(li => li.remove());
          const pre = el.querySelector('pre[data-lang]');
          const lang = pre ? (pre.getAttribute('data-lang') || '') : '';
          const lines = [];
          el.querySelectorAll('code').forEach(codeTag => {
            const text = codeTag.textContent;
            if (/^[ce]?ounter\\(line/.test(text)) return;
            lines.push(text);
          });
          if (lines.length === 0) lines.push(el.textContent);
          const placeholder = 'CODEBLOCK-PLACEHOLDER-' + codeBlocks.length;
          codeBlocks.push({ lang, code: lines.join('\\n') });
          const p = document.createElement('p');
          p.textContent = placeholder;
          el.replaceWith(p);
        });
        result.codeBlocks = codeBlocks;

        // Remove noise elements
        ['script', 'style', '.qr_code_pc', '.reward_area'].forEach(sel => {
          contentEl.querySelectorAll(sel).forEach(tag => tag.remove());
        });

        // Collect image URLs (deduplicated)
        const seen = new Set();
        contentEl.querySelectorAll('img[src]').forEach(img => {
          const src = img.getAttribute('src');
          if (src && !seen.has(src)) {
            seen.add(src);
            result.imageUrls.push(src);
          }
        });

        result.contentHtml = contentEl.innerHTML;
        return result;
      })()
    `);

    return downloadArticle(
      {
        title: data?.title || '',
        author: data?.author,
        publishTime: data?.publishTime,
        sourceUrl: url,
        contentHtml: data?.contentHtml || '',
        codeBlocks: data?.codeBlocks,
        imageUrls: data?.imageUrls,
      },
      {
        output: kwargs.output,
        downloadImages: kwargs['download-images'],
        imageHeaders: { Referer: 'https://mp.weixin.qq.com/' },
        frontmatterLabels: { author: '公众号' },
        detectImageExt: (url) => {
          const m = url.match(/wx_fmt=(\w+)/) || url.match(/\.(\w{3,4})(?:\?|$)/);
          return m ? m[1] : 'png';
        },
      },
    );
  },
});
