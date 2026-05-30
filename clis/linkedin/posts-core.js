import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  compactRepeatedText,
  normalizeHttpUrl,
  normalizeWhitespace,
  parseLimit,
  unwrapEvaluateResult,
} from './shared.js';

export const DEFAULT_POSTS_LIMIT = 20;
export const MAX_POSTS_LIMIT = 100;

export function activityUrl(profileUrl) {
  const url = assertSafeLinkedinUrl(profileUrl || 'https://www.linkedin.com/in/me/', 'profile-url', '/in/me/');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('linkedin posts requires a /in/<handle>/ profile URL');
  }
  return `https://www.linkedin.com${parsed.pathname.replace(/\/?$/, '/') }recent-activity/all/`;
}

export function parseMetric(value) {
  const raw = normalizeWhitespace(value).toLowerCase().replace(/,/g, '');
  const match = raw.match(/(\d+(?:\.\d+)?)(k|m)?/i);
  if (!match) return 0;
  const base = Number(match[1]);
  if (match[2]?.toLowerCase() === 'k') return Math.round(base * 1000);
  if (match[2]?.toLowerCase() === 'm') return Math.round(base * 1000000);
  return Math.round(base);
}

export function parseReactionText(value) {
  const text = normalizeWhitespace(value);
  const explicit = text.match(/(\d[\d,.]*\s*(?:k|m)?\s+reactions?)/i);
  if (explicit) return parseMetric(explicit[1]);
  const namedOthers = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s+[A-Z][^.!?\n]{0,100}\s+and\s+\d[\d,.]*\s+others/i);
  if (namedOthers) return parseMetric(namedOthers[1]);
  const beforeComments = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s+(?:\d[\d,.]*\s+comments?|\d[\d,.]*\s+reposts?)/i);
  if (beforeComments) return parseMetric(beforeComments[1]);
  const trailingNumber = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s*$/i);
  return trailingNumber ? parseMetric(trailingNumber[1]) : 0;
}

export function normalizePost(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn posts returned malformed row');
  }
  const body = normalizeWhitespace(row.body);
  const url = normalizeHttpUrl(row.url);
  if (!body && !url) throw new CommandExecutionError('LinkedIn posts returned a row without body or URL');
  return {
    author: compactRepeatedText(row.author),
    posted_at: normalizeWhitespace(row.posted_at),
    body,
    reactions: Number(row.reactions) || 0,
    comments: Number(row.comments) || 0,
    reposts: Number(row.reposts) || 0,
    impressions: Number(row.impressions) || 0,
    media: normalizeWhitespace(row.media),
    media_urls: normalizeWhitespace(row.media_urls)
      .split(/\s*\|\s*/)
      .map((url) => normalizeHttpUrl(url))
      .filter(Boolean)
      .join(' | '),
    url,
    raw_text: normalizeWhitespace(row.raw_text),
  };
}

export function buildPostsScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const parseMetric = (s) => {
      const raw = clean(s).toLowerCase().replace(/,/g, '');
      const m = raw.match(/(\d+(?:\.\d+)?)(k|m)?/i);
      if (!m) return 0;
      const n = Number(m[1]);
      if ((m[2] || '').toLowerCase() === 'k') return Math.round(n * 1000);
      if ((m[2] || '').toLowerCase() === 'm') return Math.round(n * 1000000);
      return Math.round(n);
    };
    const parseReactionText = (value) => {
      const text = clean(value);
      const explicit = text.match(/(\d[\d,.]*\s*(?:k|m)?\s+reactions?)/i);
      if (explicit) return parseMetric(explicit[1]);
      const namedOthers = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s+[A-Z][^.!?\n]{0,100}\s+and\s+\d[\d,.]*\s+others/i);
      if (namedOthers) return parseMetric(namedOthers[1]);
      const beforeComments = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s+(?:\d[\d,.]*\s+comments?|\d[\d,.]*\s+reposts?)/i);
      if (beforeComments) return parseMetric(beforeComments[1]);
      const trailingNumber = text.match(/(?:^|\s)(\d[\d,.]*\s*(?:k|m)?)\s*$/i);
      return trailingNumber ? parseMetric(trailingNumber[1]) : 0;
    };
    const expanders = Array.from(document.querySelectorAll('button, a'))
      .filter((el) => /\b(see more|show more|more)\b|…more/i.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
    for (const expander of expanders.slice(0, 20)) {
      try { expander.click(); } catch {}
    }
    const cards = Array.from(document.querySelectorAll('article, [role="article"], .feed-shared-update-v2, .occludable-update'))
      .filter((card) => clean(card.innerText || card.textContent || '').length > 60);
    const rows = [];
    const seen = new Set();
    const stopLine = (line) => /^(like|comment|repost|send|share|copy link|follow|following|connect|message|activate to view|promoted|show more|see more)$/i.test(line)
      || /^\d[\d,.]*\s*(?:k|m)?\s+(?:reactions?|comments?|reposts?|shares?|impressions?)$/i.test(line)
      || /^[A-Z][A-Za-z ]+\s+and\s+\d[\d,.]*\s+others$/i.test(line);
    const readBody = (root, lines) => {
      const selectors = [
        '.feed-shared-update-v2__description',
        '.update-components-text',
        '.feed-shared-text',
        '[data-test-id*="main-feed-activity-card"] [dir="ltr"]',
        '[class*="update-components-text"]'
      ];
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        const value = clean(node?.innerText || node?.textContent || '');
        if (value && value.length > 8) return value.replace(/…more$/i, '').trim();
      }
      const timestampIndex = lines.findIndex((line) => /^\d+\s*(?:s|m|h|d|w|mo|yr|min)\b/i.test(line));
      const start = timestampIndex >= 0 ? timestampIndex + 1 : Math.min(3, lines.length);
      const body = [];
      for (const line of lines.slice(start)) {
        if (stopLine(line)) break;
        if (/^(visible to anyone|edited|author|view .* profile)$/i.test(line)) continue;
        body.push(line);
      }
      return clean(body.join(' ')).replace(/…more$/i, '').trim();
    };
    const readMedia = (root) => {
      const media = [];
      const mediaUrls = [];
      const isDecorativeImageUrl = (src) => /profile-displayphoto|profile-framedphoto|company-logo|emoji|reaction|ghost-person|100_100/i.test(src || '');
      const safeHttpUrl = (value) => {
        try {
          const parsed = new URL(value, location.origin);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
          if (parsed.username || parsed.password) return '';
          return parsed.toString();
        } catch {
          return '';
        }
      };
      const images = Array.from(root.querySelectorAll('img[alt]'))
        .map((img) => ({ alt: clean(img.getAttribute('alt')), src: img.currentSrc || img.src || '' }))
        .filter((img) => img.alt
          && !/profile|photo of|emoji|reaction|^like$|^love$|^celebrate$|^support$|^funny$|^insightful$|^curious$/i.test(img.alt));
      for (const image of images) {
        media.push('image: ' + image.alt);
        const imageUrl = safeHttpUrl(image.src);
        if (imageUrl && !isDecorativeImageUrl(imageUrl)) mediaUrls.push(imageUrl);
      }
      const videos = Array.from(root.querySelectorAll('video'));
      for (const video of videos) {
        media.push('video');
        const src = video.currentSrc || video.src || video.querySelector('source')?.src || '';
        const videoUrl = safeHttpUrl(src);
        if (videoUrl) mediaUrls.push(videoUrl);
      }
      const externalLinks = Array.from(root.querySelectorAll('a[href]'))
        .map((link) => ({ href: link.href, label: clean(link.innerText || link.textContent || '') }))
        .map((link) => ({ ...link, href: safeHttpUrl(link.href) }))
        .filter((link) => link.href && !/linkedin\.com/.test(link.href))
        .slice(0, 5);
      for (const link of externalLinks) {
        media.push(clean('link: ' + (link.label || link.href) + ' ' + link.href));
        mediaUrls.push(link.href);
      }
      return {
        labels: Array.from(new Set(media)).join(' | '),
        urls: Array.from(new Set(mediaUrls)).join(' | '),
      };
    };
    for (const card of cards) {
      const root = card.closest('article, [role="article"], .feed-shared-update-v2, .occludable-update') || card;
      if (!root || seen.has(root)) continue;
      seen.add(root);
      const rawFullText = String(root.innerText || root.textContent || '');
      const rawText = clean(rawFullText);
      if (!rawText || rawText.length < 20) continue;
      const permalink = root.querySelector('a[href*="/feed/update/"], a[href*="/posts/"], a[href*="/pulse/"]');
      const url = permalink?.href ? new URL(permalink.href, location.origin).toString() : '';
      const authorLink = root.querySelector('a[href*="/in/"], a[href*="/company/"]');
      const lines = rawFullText.split(/\n+/).map(clean).filter(Boolean);
      const author = clean(authorLink?.innerText || authorLink?.textContent || '')
        || lines.find((line) => line && !/^feed post/i.test(line) && !/verified|you|senior|engineer|developer/i.test(line)) || '';
      const timestamp = (rawText.match(/\b\d+\s*(?:s|m|h|d|w|mo|yr|min)\b/i) || [''])[0];
      const reactions = parseReactionText(rawText);
      const comments = parseMetric((rawText.match(/(\d[\d,.]*\s*(?:k|m)?\s+comments?)/i) || [''])[0]);
      const reposts = parseMetric((rawText.match(/(\d[\d,.]*\s*(?:k|m)?\s+reposts?)/i) || [''])[0]);
      const impressions = parseMetric((rawText.match(/(\d[\d,.]*\s*(?:k|m)?\s+impressions?)/i) || [''])[0]);
      const body = readBody(root, lines);
      const mediaData = readMedia(root);
      if (!body && !url) continue;
      rows.push({
        author,
        posted_at: timestamp,
        body,
        reactions,
        comments,
        reposts,
        impressions,
        media: mediaData.labels,
        media_urls: mediaData.urls,
        url,
        raw_text: rawText,
      });
    }
    return { rows, url: location.href, title: document.title || '' };
  })()`;
}

export async function collectPosts(page, args) {
  if (!page) throw new CommandExecutionError('Browser session required for linkedin posts');
  const limit = parseLimit(args.limit, DEFAULT_POSTS_LIMIT, MAX_POSTS_LIMIT);
  await page.goto(activityUrl(args['profile-url']));
  await page.wait(5);
  await assertLinkedInAuthenticated(page, 'LinkedIn posts');
  let rows = [];
  for (let i = 0; i < 6 && rows.length < limit; i++) {
    const payload = unwrapEvaluateResult(await page.evaluate(buildPostsScript()));
    if (!payload || !Array.isArray(payload.rows)) {
      throw new CommandExecutionError('LinkedIn posts returned malformed extraction payload');
    }
    rows = rows.concat(payload.rows.map(normalizePost));
    const seen = new Set();
    rows = rows.filter((row) => {
      const key = row.url || `${row.author}::${row.posted_at}::${row.body.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (rows.length >= limit) break;
    await page.autoScroll({ times: 1, delayMs: 900 });
    await page.wait(1);
  }
  if (rows.length === 0) {
    throw new EmptyResultError('linkedin posts', 'No visible posts were found on the LinkedIn activity page.');
  }
  return rows.slice(0, limit).map((row, index) => ({ rank: index + 1, ...row }));
}
