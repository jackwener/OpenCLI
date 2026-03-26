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

/**
 * Format a WeChat article timestamp as a UTC+8 datetime string.
 * Accepts either Unix seconds or milliseconds.
 */
export function formatWechatTimestamp(rawTimestamp: string): string {
  const ts = Number.parseInt(rawTimestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) return '';

  const timestampMs = rawTimestamp.length === 13 ? ts : ts * 1000;
  const d = new Date(timestampMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);

  return (
    `${utc8.getUTCFullYear()}-` +
    `${pad(utc8.getUTCMonth() + 1)}-` +
    `${pad(utc8.getUTCDate())} ` +
    `${pad(utc8.getUTCHours())}:` +
    `${pad(utc8.getUTCMinutes())}:` +
    `${pad(utc8.getUTCSeconds())}`
  );
}

/**
 * Extract the raw create_time value from supported WeChat inline script formats.
 */
export function extractWechatCreateTimeValue(htmlStr: string): string {
  const jsDecodeMatch = htmlStr.match(
    /create_time\s*:\s*JsDecode\('([^']+)'\)(?=[\s,;}]|$)/,
  );
  if (jsDecodeMatch) return jsDecodeMatch[1];

  const directValueMatch = htmlStr.match(
    /create_time\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([0-9A-Za-z]+))(?=[\s,;}]|$)/,
  );
  if (!directValueMatch) return '';

  return directValueMatch[1] || directValueMatch[2] || directValueMatch[3] || '';
}

/**
 * Extract the publish time from DOM text first, then fall back to numeric create_time values.
 */
export function extractWechatPublishTime(
  publishTimeText: string | null | undefined,
  htmlStr: string,
): string {
  const normalizedPublishTime = (publishTimeText || '').trim();
  if (normalizedPublishTime) return normalizedPublishTime;

  const rawCreateTime = extractWechatCreateTimeValue(htmlStr);
  if (!/^\d{10}$|^\d{13}$/.test(rawCreateTime)) return '';

  return formatWechatTimestamp(rawCreateTime);
}

/**
 * Build a self-contained helper for execution inside page.evaluate().
 */
export function buildExtractWechatPublishTimeJs(): string {
  return `(${function extractWechatPublishTimeInPage(
    publishTimeText: string | null | undefined,
    htmlStr: string,
  ) {
    function formatWechatTimestamp(rawTimestamp: string) {
      const ts = Number.parseInt(rawTimestamp, 10);
      if (!Number.isFinite(ts) || ts <= 0) return '';

      const timestampMs = rawTimestamp.length === 13 ? ts : ts * 1000;
      const d = new Date(timestampMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);

      return (
        `${utc8.getUTCFullYear()}-` +
        `${pad(utc8.getUTCMonth() + 1)}-` +
        `${pad(utc8.getUTCDate())} ` +
        `${pad(utc8.getUTCHours())}:` +
        `${pad(utc8.getUTCMinutes())}:` +
        `${pad(utc8.getUTCSeconds())}`
      );
    }

    function extractWechatCreateTimeValue(html: string) {
      const jsDecodeMatch = html.match(
        /create_time\s*:\s*JsDecode\('([^']+)'\)(?=[\s,;}]|$)/,
      );
      if (jsDecodeMatch) return jsDecodeMatch[1];

      const directValueMatch = html.match(
        /create_time\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([0-9A-Za-z]+))(?=[\s,;}]|$)/,
      );
      if (!directValueMatch) return '';

      return directValueMatch[1] || directValueMatch[2] || directValueMatch[3] || '';
    }

    const normalizedPublishTime = (publishTimeText || '').trim();
    if (normalizedPublishTime) return normalizedPublishTime;

    const rawCreateTime = extractWechatCreateTimeValue(htmlStr);
    if (!/^\d{10}$|^\d{13}$/.test(rawCreateTime)) return '';

    return formatWechatTimestamp(rawCreateTime);
  }.toString()})`;
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

        // Publish time: prefer the rendered DOM text, then fall back to numeric create_time values.
        const publishTimeEl = document.querySelector('#publish_time');
        const extractWechatPublishTime = ${buildExtractWechatPublishTimeJs()};
        result.publishTime = extractWechatPublishTime(
          publishTimeEl ? publishTimeEl.textContent : '',
          document.documentElement.innerHTML,
        );

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
