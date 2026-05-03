import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, getErrorMessage } from '@jackwener/opencli/errors';
import { htmlToMarkdown, mapConcurrent } from '@jackwener/opencli/utils';
import { findMacroSource, listMacroSourceUrls, resolveMacroSourceUrl } from './data.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; opencli macro-page/1.0)';
const FETCH_TIMEOUT_MS = 15_000;
const DETAIL_CONCURRENCY = 3;

export const pageCommand = cli({
  site: 'macro',
  name: 'page',
  aliases: ['read', 'webpage'],
  description: '抓取宏观信息源网页有效内容，支持按时间过滤',
  strategy: Strategy.PUBLIC,
  browser: false,
  timeoutSeconds: 180,
  args: [
    { name: 'id', required: true, positional: true, help: '信息源 id、名称或别名，如 stats-cn、pbc、imf' },
    { name: 'url-index', type: 'int', default: 1, help: '同一信息源有多个 URL 时选择第几个，1 开始' },
    { name: 'date', valueRequired: true, help: '时间过滤：2026、2026-04 或 2026-04-30' },
    { name: 'from', valueRequired: true, help: '起始日期：YYYY、YYYY-MM 或 YYYY-MM-DD' },
    { name: 'to', valueRequired: true, help: '截止日期：YYYY、YYYY-MM 或 YYYY-MM-DD' },
    { name: 'limit', type: 'int', default: 20, help: '最多输出多少条有效内容' },
    { name: 'detail', type: 'boolean', default: false, help: '抓取每条内容详情页正文预览' },
    { name: 'chars', type: 'int', default: 800, help: '每条详情正文最多输出多少字符' },
    { name: 'links', type: 'boolean', default: false, help: 'raw-page 模式下同时输出页面链接' },
    { name: 'raw-page', type: 'boolean', default: false, help: '输出整页转文本结果，而不是有效内容条目' },
  ],
  columns: ['date', 'title', 'text', 'url', 'source'],
  func: async (_page, kwargs) => {
    const source = findMacroSource(kwargs.id);
    if (!source) {
      throw new ArgumentError(
        `Unknown macro source: ${kwargs.id}`,
        'Run "opencli macro sources" to list available source ids.',
      );
    }

    const sourceUrls = listMacroSourceUrls(source);
    if (!sourceUrls.length) {
      throw new ArgumentError(
        `Macro source has no webpage URL: ${source.id}`,
        'This source was mentioned in the PDF without a concrete URL.',
      );
    }

    const target = resolveMacroSourceUrl(source, kwargs['url-index']);
    if (!target) {
      throw new ArgumentError(
        `Invalid --url-index for ${source.id}: ${kwargs['url-index']}`,
        `Use a value between 1 and ${sourceUrls.length}.`,
      );
    }

    const timeFilter = resolveTimeFilter(kwargs);
    const page = await fetchHtmlPage(target.url);
    if (kwargs['raw-page'] === true) {
      return {
        source: `${source.id} / ${source.name}`,
        url: page.url,
        title: page.title,
        text: truncateText(htmlToText(page.html), kwargs.chars),
        ...(kwargs.links === true ? { links: extractLinks(page.html, page.url).slice(0, 80).join('\n') } : {}),
      };
    }

    const limit = positiveInt(kwargs.limit, 20);
    let items = extractContentItems(page.html, page.url)
      .filter(item => matchesTimeFilter(item, timeFilter))
      .slice(0, limit);

    if (kwargs.detail === true) {
      items = await attachDetails(items, kwargs.chars);
    }

    return items.map(item => ({
      date: item.date ?? '',
      title: item.title,
      text: item.text ?? '',
      url: item.url,
      source: `${source.id} / ${source.name}`,
    }));
  },
});

async function fetchHtmlPage(url, options = {}) {
  const timeoutMs = positiveInt(options.timeoutMs, FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
      },
    });
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to fetch ${url}: ${getErrorMessage(err)}`,
      `The request timed out or the site refused the connection. Timeout: ${Math.round(timeoutMs / 1000)}s.`,
    );
  }

  if (!response.ok) {
    throw new CommandExecutionError(
      `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
      'Try the source URL in a browser, or rerun later if the site is temporarily unavailable.',
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';
  const html = decodeHtml(buffer, contentType);
  const finalUrl = response.url || url;

  return {
    url: finalUrl,
    title: extractTitle(html),
    html,
  };
}

function decodeHtml(buffer, contentType) {
  const utf8 = buffer.toString('utf8');
  const charset = findCharset(contentType, utf8);
  if (!charset || /^utf-?8$/i.test(charset)) return utf8;

  try {
    return new TextDecoder(normalizeCharset(charset)).decode(buffer);
  } catch {
    return utf8;
  }
}

function findCharset(contentType, html) {
  const headerMatch = contentType.match(/charset=([^;\s]+)/i);
  if (headerMatch) return headerMatch[1].replace(/^["']|["']$/g, '');

  const metaMatch = html.match(/<meta[^>]+charset=["']?\s*([^\s"'/>]+)/i)
    || html.match(/<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i);
  return metaMatch?.[1];
}

function normalizeCharset(charset) {
  const value = charset.toLowerCase();
  if (value === 'gbk' || value === 'gb2312') return 'gb18030';
  return value;
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(decodeEntities(stripTags(match[1]))) : '';
}

function htmlToText(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');

  return htmlToMarkdown(cleaned, (td) => {
    td.addRule('plainLinks', {
      filter: 'a',
      replacement: content => content,
    });
    td.addRule('imageAltText', {
      filter: 'img',
      replacement: (_content, node) => node.getAttribute('alt') || '',
    });
  })
    .split('\n')
    .map(line => normalizeText(line))
    .filter(Boolean)
    .filter(line => !/^\s*(function|var |let |const |\{|\}|\/\*)/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function positiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function truncateText(text, limit) {
  const max = positiveInt(limit, 8000);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}\n...[truncated ${text.length - max} chars]`;
}

function extractLinks(html, baseUrl) {
  return extractLinkObjects(html, baseUrl).map(link => `${link.label || link.url} - ${link.url}`);
}

function extractLinkObjects(html, baseUrl) {
  const rows = [];
  const seen = new Set();
  const linkRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html))) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i) || attrs.match(/\bhref\s*=\s*([^\s>]+)/i);
    const rawHref = hrefMatch?.[2] ?? hrefMatch?.[1];
    if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) continue;

    let href;
    try {
      href = new URL(decodeEntities(rawHref), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(href)) continue;

    const label = normalizeText(decodeEntities(stripTags(match[2])));
    const context = extractAnchorContext(html, match.index, linkRegex.lastIndex, match[0]);
    const key = `${label}\n${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, url: href, context });
  }
  return rows;
}

function extractAnchorContext(html, start, end, anchorHtml) {
  const before = html.slice(Math.max(0, start - 1200), start);
  const after = html.slice(end, Math.min(html.length, end + 1200));
  const openMatch = findLastBlockOpen(before);
  if (!openMatch) return '';

  const tag = openMatch.tag;
  const closeMatch = after.match(new RegExp(`[\\s\\S]*?<\\/${tag}>`, 'i'));
  const fragment = `${openMatch.fragment}${anchorHtml}${closeMatch?.[0] ?? ''}`;
  return normalizeText(decodeEntities(stripTags(fragment))).slice(0, 500);
}

function findLastBlockOpen(fragment) {
  const pattern = /<(li|tr|p|div|article|section)\b[^>]*>/gi;
  let match;
  let last;
  while ((match = pattern.exec(fragment))) {
    last = {
      tag: match[1],
      fragment: fragment.slice(match.index),
    };
  }
  return last;
}

function extractContentItems(html, baseUrl) {
  return extractLinkObjects(html, baseUrl)
    .map(link => {
      const label = cleanupItemTitle(link.label);
      const dateInfo = extractItemDate(`${label} ${link.context ?? ''} ${link.url}`);
      return {
        title: label,
        url: link.url,
        date: dateInfo?.display,
        dateStart: dateInfo?.start,
        dateEnd: dateInfo?.end,
      };
    })
    .filter(item => isUsefulContentItem(item));
}

function isUsefulContentItem(item) {
  if (!item.title || item.title.length < 4) return false;
  if (isNavigationLabel(item.title)) return false;
  if (!/^https?:\/\//i.test(item.url)) return false;
  return Boolean(item.dateStart) || /\/(?:20\d{2}|19\d{2})/.test(item.url) || /20\d{2}年/.test(item.title);
}

function cleanupItemTitle(title) {
  return normalizeText(title)
    .replace(/^[-·•\s]+/, '')
    .replace(/\s*更多\s*>>?$/i, '')
    .trim();
}

function isNavigationLabel(label) {
  const compact = label.replace(/\s+/g, '');
  const blocked = new Set([
    '首页', '机构', '新闻', '数据', '公开', '服务', '互动', '知识', '专题', '搜索', '更多', '更多>>',
    '网站地图', '术语表', 'EnglishVersion', '无障碍浏览', '关于我们', '联系我们', '加入收藏',
    '时政要闻', '统计新闻', '新闻发布', '法律法规', '货币政策', '调查统计', '服务互动',
    '字体：', '分享到：', '打印', '关闭', '扫一扫', '微信', '微博', '-', '|',
  ]);
  if (blocked.has(compact)) return true;
  return compact.length <= 3 && /^[A-Za-z0-9\u4e00-\u9fa5]+$/.test(compact);
}

function extractItemDate(value) {
  const text = String(value ?? '');
  let match = text.match(/(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), Number(match[3]), 'day');

  match = text.match(/(20\d{2}|19\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), Number(match[3]), 'day');

  match = text.match(/(?:^|[^\d])(20\d{2}|19\d{2})(0[1-9]|1[0-2])([0-3]\d)(?:[^\d]|$)/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), Number(match[3]), 'day');

  match = text.match(/(20\d{2}|19\d{2})年(\d{1,2})月/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), 1, 'month');

  match = text.match(/\/(20\d{2})(\d{2})\//);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), 1, 'month');

  match = text.match(/(20\d{2}|19\d{2})年/);
  if (match) return dateInfo(Number(match[1]), 1, 1, 'year');

  match = text.match(/\/(20\d{2})[a-z_/.-]/i);
  if (match) return dateInfo(Number(match[1]), 1, 1, 'year');

  return undefined;
}

function dateInfo(year, month, day, granularity) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  const start = new Date(Date.UTC(year, month - 1, day));
  if (
    start.getUTCFullYear() !== year
    || start.getUTCMonth() !== month - 1
    || start.getUTCDate() !== day
  ) {
    return undefined;
  }

  let end = start;
  let display = `${year}`;
  if (granularity === 'day') {
    display = `${year}-${pad2(month)}-${pad2(day)}`;
  } else if (granularity === 'month') {
    display = `${year}-${pad2(month)}`;
    end = new Date(Date.UTC(year, month, 0));
  } else if (granularity === 'year') {
    end = new Date(Date.UTC(year, 11, 31));
  }
  return { display, start, end };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function resolveTimeFilter(kwargs) {
  if (kwargs.date) {
    const range = parseDateRange(kwargs.date);
    if (!range) throw new ArgumentError(`Invalid --date value: ${kwargs.date}`, 'Use YYYY, YYYY-MM, or YYYY-MM-DD.');
    return range;
  }

  const from = kwargs.from ? parseDateRange(kwargs.from)?.start : undefined;
  const to = kwargs.to ? parseDateRange(kwargs.to)?.end : undefined;
  if (kwargs.from && !from) throw new ArgumentError(`Invalid --from value: ${kwargs.from}`, 'Use YYYY, YYYY-MM, or YYYY-MM-DD.');
  if (kwargs.to && !to) throw new ArgumentError(`Invalid --to value: ${kwargs.to}`, 'Use YYYY, YYYY-MM, or YYYY-MM-DD.');

  return from || to ? { start: from, end: to } : undefined;
}

function parseDateRange(value) {
  const raw = String(value ?? '').trim();
  let match = raw.match(/^(20\d{2}|19\d{2})$/);
  if (match) return dateInfo(Number(match[1]), 1, 1, 'year');

  match = raw.match(/^(20\d{2}|19\d{2})[-/](\d{1,2})$/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), 1, 'month');

  match = raw.match(/^(20\d{2}|19\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) return dateInfo(Number(match[1]), Number(match[2]), Number(match[3]), 'day');

  return undefined;
}

function matchesTimeFilter(item, filter) {
  if (!filter) return true;
  if (!item.dateStart || !item.dateEnd) return false;

  const filterStart = filter.start ?? new Date(Date.UTC(0, 0, 1));
  const filterEnd = filter.end ?? new Date(Date.UTC(9999, 11, 31));
  return item.dateEnd >= filterStart && item.dateStart <= filterEnd;
}

async function attachDetails(items, chars) {
  return mapConcurrent(items, DETAIL_CONCURRENCY, async (item) => {
    try {
      const page = await fetchHtmlPage(item.url);
      return {
        ...item,
        text: truncateText(extractArticleText(page.html), chars),
      };
    } catch (err) {
      return {
        ...item,
        text: `Failed to fetch detail: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}

function extractArticleText(html) {
  const preferred = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:TRS_Editor|article|content|detail|正文|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of preferred) {
    const match = html.match(pattern);
    if (!match) continue;
    const text = cleanArticleText(htmlToText(match[1]));
    if (text.length > 80) return text;
  }

  return cleanArticleText(htmlToText(html));
}

function cleanArticleText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^[-|]+$/.test(line))
    .filter(line => !isNavigationLabel(line))
    .filter(line => !/^当前位置[:：]/.test(line))
    .filter(line => !/^法律声明|联系我们|网站地图|设为首页|加入收藏/.test(line))
    .filter(line => !/^字体[:：]|^分享到[:：]|^字号[:：]|^来源[:：]\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '(c)',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity) => {
    const key = entity.toLowerCase();
    if (key[0] === '#') {
      const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return named[key] ?? '';
  });
}
