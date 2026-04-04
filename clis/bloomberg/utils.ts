import { CliError } from '../../src/errors.js';

export const BLOOMBERG_FEEDS = {
  main: 'https://feeds.bloomberg.com/news.rss',
  markets: 'https://feeds.bloomberg.com/markets/news.rss',
  economics: 'https://feeds.bloomberg.com/economics/news.rss',
  industries: 'https://feeds.bloomberg.com/industries/news.rss',
  tech: 'https://feeds.bloomberg.com/technology/news.rss',
  politics: 'https://feeds.bloomberg.com/politics/news.rss',
  businessweek: 'https://feeds.bloomberg.com/businessweek/news.rss',
  opinions: 'https://feeds.bloomberg.com/bview/news.rss',
} as const;

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; opencli)';

export type BloombergFeedName = keyof typeof BLOOMBERG_FEEDS;

export interface BloombergFeedItem {
  title: string;
  summary: string;
  link: string;
  mediaLinks: string[];
}

export interface BloombergStory {
  headline?: string;
  summary?: string;
  url?: string;
  body?: any;
  lede?: any;
  ledeImageUrl?: string;
  socialImageUrl?: string;
  imageAttachments?: Record<string, any>;
  videoAttachments?: Record<string, any>;
}

export async function fetchBloombergFeed(name: BloombergFeedName, limit: number = 1): Promise<BloombergFeedItem[]> {
  const feedUrl = BLOOMBERG_FEEDS[name];
  if (!feedUrl) {
    throw new CliError('ARGUMENT', `Unknown Bloomberg feed: ${name}`);
  }

  const resp = await fetch(feedUrl, {
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
  });

  if (!resp.ok) {
    throw new CliError(
      'FETCH_ERROR',
      `Bloomberg RSS HTTP ${resp.status}`,
      'Bloomberg may be temporarily unavailable; try again later.',
    );
  }

  const xml = await resp.text();
  const items = parseBloombergRss(xml);
  if (!items.length) {
    throw new CliError(
      'NOT_FOUND',
      'Bloomberg RSS feed returned no items',
      'Bloomberg may have changed the feed format.',
    );
  }

  const count = Math.max(1, Math.min(Number(limit) || 1, 20));
  return items.slice(0, count);
}

export function parseBloombergRss(xml: string): BloombergFeedItem[] {
  const items: BloombergFeedItem[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml))) {
    const block = match[1];
    const title = extractTagText(block, 'title');
    const summary = extractTagText(block, 'description');
    const link = extractTagText(block, 'link') || extractTagText(block, 'guid');
    const mediaLinks = extractMediaLinksFromRssItem(block);

    if (!title || !link) continue;
    items.push({
      title,
      summary,
      link,
      mediaLinks,
    });
  }

  return items;
}

export function normalizeBloombergLink(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new CliError('ARGUMENT', 'A Bloomberg link is required');
  }
  if (raw.startsWith('/')) return `https://www.bloomberg.com${raw}`;
  return raw;
}

export function validateBloombergLink(input: string): string {
  const normalized = normalizeBloombergLink(input);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new CliError(
      'ARGUMENT',
      `Invalid Bloomberg link: ${input}`,
      'Pass a full https://www.bloomberg.com/... URL or a relative Bloomberg path.',
    );
  }

  if (!/(?:\.|^)bloomberg\.com$/i.test(url.hostname)) {
    throw new CliError(
      'ARGUMENT',
      `Expected a bloomberg.com link, got: ${url.hostname}`,
      'Pass a Bloomberg article URL from bloomberg.com.',
    );
  }

  return url.toString();
}

export function renderStoryBody(body: any): string {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const parts = blocks
    .map((block: any) => renderBlock(block, 0))
    .map((part: string) => normalizeBlockText(part))
    .filter(Boolean);

  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function extractStoryMediaLinks(story: BloombergStory): string[] {
  const urls = new Set<string>();
  collectMediaUrls(story?.ledeImageUrl, urls);
  collectMediaUrls(story?.socialImageUrl, urls);
  collectMediaUrls(story?.lede, urls);
  collectMediaUrls(story?.imageAttachments, urls);
  collectMediaUrls(story?.videoAttachments, urls);

  const mediaBlocks = Array.isArray(story?.body?.content)
    ? story.body.content.filter((block: any) => block?.type === 'media')
    : [];
  collectMediaUrls(mediaBlocks, urls);

  return [...urls];
}

function renderBlock(block: any, depth: number): string {
  if (!block || typeof block !== 'object') return '';

  switch (block.type) {
    case 'paragraph':
      return renderInlineNodes(block.content || []);
    case 'heading': {
      const text = renderInlineNodes(block.content || []);
      if (!text) return '';
      const level = Number(block.data?.level ?? block.data?.weight ?? 2);
      const prefix = level <= 1 ? '# ' : level === 2 ? '## ' : '### ';
      return `${prefix}${text}`;
    }
    case 'blockquote': {
      const text = renderInlineNodes(block.content || []);
      if (!text) return '';
      return text.split('\n').map((line: string) => line ? `> ${line}` : '>').join('\n');
    }
    case 'list':
      return renderListBlock(block, depth);
    case 'tabularData':
      return renderTabularDataBlock(block);
    case 'media':
      return renderMediaBlock(block);
    case 'inline-newsletter':
    case 'newsletter':
    case 'ad':
      return '';
    default: {
      if (Array.isArray(block.content) && block.content.length > 0) {
        const inlineText = renderInlineNodes(block.content);
        if (inlineText) return inlineText;
        const nested = block.content.map((child: any) => renderBlock(child, depth + 1)).filter(Boolean);
        if (nested.length) return nested.join('\n');
      }
      return extractGenericText(block);
    }
  }
}

function renderInlineNodes(nodes: any[]): string {
  return nodes.map((node) => renderInlineNode(node)).join('');
}

function renderInlineNode(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return decodeXmlEntities(node);

  switch (node.type) {
    case 'text':
      return decodeXmlEntities(node.value || '');
    case 'linebreak':
      return '\n';
    case 'link':
    case 'entity':
    case 'strong':
    case 'emphasis':
    case 'italic':
    case 'underline':
    case 'span':
      if (Array.isArray(node.content) && node.content.length > 0) {
        return renderInlineNodes(node.content);
      }
      return decodeXmlEntities(node.value || '');
    default:
      if (Array.isArray(node.content) && node.content.length > 0) {
        return renderInlineNodes(node.content);
      }
      if (typeof node.value === 'string') return decodeXmlEntities(node.value);
      return '';
  }
}

function renderListBlock(block: any, depth: number): string {
  const items = Array.isArray(block.content) ? block.content : [];
  if (!items.length) return '';

  const listStyle = String(block.subType || block.data?.style || block.data?.listType || '');
  const ordered = /\bordered\b|\bnumber(?:ed)?\b/i.test(listStyle);
  let index = 1;

  return items
    .map((item: any) => {
      const prefix = ordered ? `${index++}. ` : '- ';
      return renderListItem(item, prefix, depth);
    })
    .filter(Boolean)
    .join('\n');
}

function renderListItem(item: any, prefix: string, depth: number): string {
  const indent = '  '.repeat(depth);
  const body = normalizeBlockText(renderListItemBody(item, depth + 1));
  if (!body) return '';

  const lines = body.split('\n');
  const head = `${indent}${prefix}${lines[0]}`;
  if (lines.length === 1) return head;

  const continuationIndent = `${indent}${' '.repeat(prefix.length)}`;
  const tail = lines.slice(1).map((line) => `${continuationIndent}${line}`).join('\n');
  return `${head}\n${tail}`;
}

function renderListItemBody(item: any, depth: number): string {
  if (!item || typeof item !== 'object') return '';

  if (item.type === 'list-item' && Array.isArray(item.content)) {
    const parts = item.content
      .map((child: any) => child?.type === 'paragraph'
        ? renderInlineNodes(child.content || [])
        : renderBlock(child, depth))
      .map((part: string) => normalizeBlockText(part))
      .filter(Boolean);
    return parts.join('\n');
  }

  return renderBlock(item, depth);
}

function renderTabularDataBlock(block: any): string {
  const rows = block?.data?.rows ?? block?.data?.table?.rows ?? block?.content;
  if (!Array.isArray(rows) || !rows.length) {
    return extractGenericText(block.data || block.content || block);
  }

  const lines = rows
    .map((row: any) => extractGenericText(row))
    .map((line) => normalizeBlockText(line))
    .filter(Boolean);

  return lines.join('\n');
}

function renderMediaBlock(block: any): string {
  const candidates = [
    block?.data?.chart?.caption,
    block?.data?.attachment?.caption,
    block?.data?.attachment?.title,
    block?.data?.attachment?.subtitle,
    block?.data?.video?.caption,
  ];

  const caption = candidates
    .map((value) => normalizeBlockText(stripHtml(String(value || ''))))
    .find(Boolean);

  return caption || '';
}

function extractGenericText(value: any): string {
  const parts: string[] = [];
  collectText(value, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function collectText(value: any, out: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    const text = normalizeBlockText(stripHtml(decodeXmlEntities(value)));
    if (text) out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (typeof value === 'object') {
    if (typeof value.value === 'string') {
      const text = normalizeBlockText(stripHtml(decodeXmlEntities(value.value)));
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(value.content)) {
      collectText(value.content, out);
      return;
    }
    for (const entry of Object.values(value)) collectText(entry, out);
  }
}

function extractTagText(block: string, tag: string): string {
  const safeTag = escapeRegExp(tag);
  const match = block.match(new RegExp(`<${safeTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safeTag}>`, 'i'));
  if (!match) return '';
  return normalizeBlockText(stripHtml(decodeXmlEntities(stripCdata(match[1]))));
}

function extractMediaLinksFromRssItem(block: string): string[] {
  const links = new Set<string>();
  const mediaRegex = /<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl="([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = mediaRegex.exec(block))) {
    const url = decodeXmlEntities(match[1] || '').trim();
    if (url) links.add(url);
  }
  return [...links];
}

function collectMediaUrls(value: any, out: Set<string>, seen = new WeakSet<object>()): void {
  if (value == null) return;

  if (typeof value === 'string') {
    const normalized = normalizeMediaUrl(value);
    if (normalized) out.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, out, seen);
    return;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);

    for (const key of ['url', 'src', 'fallback', 'poster']) {
      const candidate = (value as Record<string, any>)[key];
      if (typeof candidate === 'string') {
        const normalized = normalizeMediaUrl(candidate);
        if (normalized) out.add(normalized);
      }
    }

    for (const entry of Object.values(value)) {
      collectMediaUrls(entry, out, seen);
    }
  }
}

function normalizeMediaUrl(value: string): string | null {
  const url = decodeXmlEntities(String(value || '')).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (!looksLikeMediaUrl(url)) return null;
  return url;
}

function looksLikeMediaUrl(url: string): boolean {
  return /(?:assets\.bwbx\.io|resource\.bloomberg\.com|media\.bloomberg\.com)/i.test(url)
    || /\.(?:jpg|jpeg|png|webp|gif|svg|mp4|m3u8)(?:[?#].*)?$/i.test(url);
}

function stripCdata(value: string): string {
  const match = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return match ? match[1] : value;
}

function stripHtml(value: string): string {
  return String(value || '').replace(/<[^>]+>/g, ' ');
}

function decodeXmlEntities(value: string): string {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function normalizeBlockText(value: string): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
