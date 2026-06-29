import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const CLS_BASE = 'https://www.cls.cn';
export const CLS_DOMAIN = 'www.cls.cn';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; opencli/1.0; +https://github.com/jackwener/opencli)',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
  const raw = value ?? defaultValue;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  if (limit > maxValue) {
    throw new ArgumentError(`${label} must be <= ${maxValue}`);
  }
  return limit;
}

export function parseArticleId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new ArgumentError('cls article id must not be empty');

  const detailMatch = raw.match(/(?:^|\/)detail\/(\d+)(?:[/?#]|$)/);
  const id = detailMatch?.[1] ?? (/^\d+$/.test(raw) ? raw : '');
  if (!id) {
    throw new ArgumentError('cls article id must be a numeric id or https://www.cls.cn/detail/<id> URL');
  }
  return id;
}

export async function fetchJson(url, commandLabel) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        ...REQUEST_HEADERS,
        Accept: 'application/json,text/plain,*/*',
        Referer: `${CLS_BASE}/`,
      },
    });
  } catch (error) {
    throw new CommandExecutionError(`${commandLabel} request failed: ${error?.message || error}`);
  }
  if (!resp.ok) {
    throw new CommandExecutionError(`${commandLabel} request failed: HTTP ${resp.status}`);
  }
  try {
    return await resp.json();
  } catch (error) {
    throw new CommandExecutionError(`${commandLabel} returned malformed JSON: ${error?.message || error}`);
  }
}

export async function fetchHtml(url, commandLabel) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        ...REQUEST_HEADERS,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${CLS_BASE}/`,
      },
      redirect: 'follow',
    });
  } catch (error) {
    throw new CommandExecutionError(`${commandLabel} request failed: ${error?.message || error}`);
  }
  if (!resp.ok) {
    throw new CommandExecutionError(`${commandLabel} request failed: HTTP ${resp.status}`);
  }
  try {
    return await resp.text();
  } catch (error) {
    throw new CommandExecutionError(`${commandLabel} returned unreadable HTML: ${error?.message || error}`);
  }
}

export function htmlToText(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function unixSecondsToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function toCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function joinSubjects(value) {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.subject_name ?? item?.name ?? item?.title ?? '';
    })
    .map((item) => String(item).trim())
    .filter(Boolean)
    .join(', ');
}

function joinStocks(value) {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      const name = String(item?.stock_name ?? item?.name ?? '').trim();
      const code = String(item?.stock_code ?? item?.code ?? '').trim();
      if (name && code) return `${name}(${code})`;
      return name || code;
    })
    .filter(Boolean)
    .join(', ');
}

function requireArticleId(row, commandLabel) {
  const id = String(row?.id ?? row?.article_id ?? '').trim();
  if (!/^\d+$/.test(id)) {
    throw new CommandExecutionError(`${commandLabel} returned malformed payload: row is missing a numeric id`);
  }
  return id;
}

function getArticleSubjects(detail) {
  return detail?.subject ?? detail?.subjects ?? detail?.subjectList ?? [];
}

function getReadingCount(detail) {
  return detail?.readingNum ?? detail?.reading_num ?? detail?.reading_count ?? null;
}

function getAudioUrl(detail) {
  return detail?.miniMaxAudioUrl ?? detail?.mini_max_audio_url ?? detail?.audio_url ?? null;
}

function normalizeAuthor(value) {
  if (typeof value === 'string') {
    const author = value.trim();
    return author || null;
  }
  if (!value || typeof value !== 'object') return null;
  const author = value.name ?? value.nickname ?? value.author_name ?? value.username;
  return typeof author === 'string' && author.trim() ? author.trim() : null;
}

export function mapTelegraphRows(items, limit) {
  if (!Array.isArray(items)) {
    throw new CommandExecutionError('cls telegraph returned malformed payload: roll_data must be an array');
  }
  if (items.length === 0) {
    throw new EmptyResultError('cls telegraph', 'The public telegraph cache returned no rows.');
  }

  return items.slice(0, limit).map((item, index) => {
    const id = requireArticleId(item, 'cls telegraph');
    const content = htmlToText(item?.content || item?.brief || item?.title);
    const title = htmlToText(item?.title || content || item?.brief);
    if (!title) {
      throw new CommandExecutionError(`cls telegraph returned malformed payload for ${id}: title/content is missing`);
    }
    return {
      rank: index + 1,
      id,
      title,
      content,
      subjects: joinSubjects(item?.subjects),
      stocks: joinStocks(item?.stock_list),
      level: item?.level ? String(item.level) : null,
      readingCount: toCount(item?.reading_num),
      commentCount: toCount(item?.comment_num),
      shareCount: toCount(item?.share_num),
      pubTime: unixSecondsToIso(item?.ctime),
      url: `${CLS_BASE}/detail/${id}`,
    };
  });
}

export function extractArticleDetailFromNextData(html) {
  const match = String(html ?? '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new EmptyResultError('cls article', 'The detail page did not contain __NEXT_DATA__.');
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new CommandExecutionError(`cls article returned malformed __NEXT_DATA__: ${error?.message || error}`);
  }

  const candidates = [
    data?.props?.pageProps?.articleDetail,
    data?.props?.pageProps?.initialState?.articleDetail,
    data?.props?.pageProps?.detail,
  ];
  const detail = candidates.find((item) => item && typeof item === 'object');
  if (!detail) {
    throw new EmptyResultError('cls article', 'The public detail page did not expose articleDetail.');
  }
  return detail;
}

export function mapArticleDetailRow(detail) {
  const id = requireArticleId(detail, 'cls article');
  const title = String(detail?.title ?? '').trim();
  if (!title) {
    throw new CommandExecutionError(`cls article returned malformed payload for ${id}: title is missing`);
  }
  const content = htmlToText(detail?.content ?? '');
  if (!content) {
    throw new CommandExecutionError(`cls article returned malformed payload for ${id}: content is missing`);
  }
  return {
    id,
    title,
    content,
    brief: htmlToText(detail?.brief ?? ''),
    subjects: joinSubjects(getArticleSubjects(detail)),
    author: normalizeAuthor(detail?.author),
    level: detail?.level ? String(detail.level) : null,
    readingCount: toCount(getReadingCount(detail)),
    pubTime: unixSecondsToIso(detail?.ctime),
    audioUrl: getAudioUrl(detail) ? String(getAudioUrl(detail)) : null,
    url: `${CLS_BASE}/detail/${id}`,
  };
}
