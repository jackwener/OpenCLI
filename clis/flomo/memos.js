import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import { createHash } from 'node:crypto';

const FLOMO_APP_DOMAIN = 'v.flomoapp.com';
const FLOMO_API_DOMAIN = 'flomoapp.com';
const MAX_LIMIT = 200;

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
    return value.data;
  }
  return value;
}

function parsePositiveIntArg(value, name, fallback, max) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new ArgumentError(`flomo memos --${name} must be a positive integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ArgumentError(`flomo memos --${name} must be between 1 and ${max}`);
  }
  return parsed;
}

function parseSinceArg(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new ArgumentError('flomo memos --since must be a non-negative Unix timestamp in seconds');
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new ArgumentError('flomo memos --since must be a safe integer Unix timestamp in seconds');
  }
  return parsed;
}

function parseSlugArg(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const slug = String(value).trim();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(slug)) {
    throw new ArgumentError('flomo memos --slug must be an opaque memo cursor containing only letters, numbers, _ or -');
  }
  return slug;
}

function buildSignedUrl(limit, since, slug) {
  const params = {
    limit: String(limit),
    latest_updated_at: String(since),
    tz: '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
  if (slug) params.latest_slug = slug;
  const keys = Object.keys(params).sort();
  const signBase = keys.map((key) => `${key}=${params[key]}`).join('&');
  params.sign = createHash('md5').update(signBase + 'dbbc3dd73364b4084c3a69346e0ce2b2').digest('hex');
  return 'https://flomoapp.com/api/v1/memo/updated/?' + new URLSearchParams(params).toString();
}

function buildGetTokenJs() {
  return `
    (() => {
      try {
        const raw = localStorage.getItem('me');
        if (!raw) return null;
        const me = JSON.parse(raw);
        const token = me?.access_token || me?.data?.access_token || '';
        return typeof token === 'string' && token.trim() ? token.trim() : null;
      } catch {
        return null;
      }
    })()
  `;
}

function isAuthFailureMessage(message) {
  return /auth|unauth|login|token|permission|forbidden|unauthorized|登录|登陆|鉴权|权限/i.test(String(message || ''));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return '';
  return tags
    .map((tag) => {
      if (typeof tag === 'string') return tag;
      return tag?.name || tag?.tag || tag?.content || '';
    })
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .join(', ');
}

function normalizeImages(files) {
  if (!Array.isArray(files)) return '';
  return files
    .map((file) => file?.thumbnail_url || file?.url || '')
    .map((url) => String(url).trim())
    .filter(Boolean)
    .join(' | ');
}

function memoUrl(slug) {
  return slug ? `https://${FLOMO_APP_DOMAIN}/mine/?memo_id=${encodeURIComponent(slug)}` : '';
}

function normalizeMemo(memo) {
  if (!memo || typeof memo !== 'object' || Array.isArray(memo)) {
    throw new CommandExecutionError('Flomo API returned a malformed memo entry');
  }
  const slug = String(memo.slug || memo.id || '').trim();
  if (!slug) {
    throw new CommandExecutionError('Flomo API returned a memo without slug/id');
  }
  return {
    id: slug,
    url: memoUrl(slug),
    content: String(memo.content || '').trim(),
    slug,
    tags: normalizeTags(memo.tags),
    images: normalizeImages(memo.files),
    created_at: String(memo.created_at || ''),
    updated_at: String(memo.updated_at || ''),
  };
}

async function fetchFlomoJson(url, token) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new CommandExecutionError(`Failed to fetch Flomo memos: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new AuthRequiredError(FLOMO_API_DOMAIN, `Flomo API returned HTTP ${resp.status}; please refresh your Flomo login session`);
  }
  if (!resp.ok) {
    throw new CommandExecutionError(`Flomo API returned HTTP ${resp.status}`);
  }
  try {
    return await resp.json();
  } catch (err) {
    throw new CommandExecutionError(`Flomo API returned malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readAccessToken(page) {
  const token = unwrapBrowserResult(await page.evaluate(buildGetTokenJs()));
  if (typeof token !== 'string' || !token.trim()) {
    throw new AuthRequiredError(FLOMO_API_DOMAIN, 'Flomo memos requires an active signed-in Flomo browser session');
  }
  return token.trim();
}

const command = cli({
  site: 'flomo',
  name: 'memos',
  access: 'read',
  description: 'List your Flomo memos',
  domain: FLOMO_API_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: `https://${FLOMO_APP_DOMAIN}/`,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of memos to fetch (1-200)' },
    { name: 'since', type: 'int', help: 'Only memos updated after this Unix timestamp in seconds' },
    { name: 'slug', help: 'Pagination cursor from a previous memo page' },
  ],
  columns: ['id', 'url', 'content', 'slug', 'tags', 'images', 'created_at', 'updated_at'],
  func: async (page, kwargs) => {
    const limit = parsePositiveIntArg(kwargs.limit, 'limit', 20, MAX_LIMIT);
    const since = parseSinceArg(kwargs.since);
    const slug = parseSlugArg(kwargs.slug);
    await page.wait(3).catch(() => {});
    const token = await readAccessToken(page);
    const body = await fetchFlomoJson(buildSignedUrl(limit, since, slug), token);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new CommandExecutionError('Flomo API returned a malformed response');
    }
    if (body.code !== 0) {
      const message = body.message || `Flomo API error code ${body.code}`;
      if (isAuthFailureMessage(message)) {
        throw new AuthRequiredError(FLOMO_API_DOMAIN, message);
      }
      throw new CommandExecutionError(message);
    }
    if (!Array.isArray(body.data)) {
      throw new CommandExecutionError('Flomo API returned malformed memo data');
    }
    if (body.data.length === 0) {
      throw new EmptyResultError('flomo memos', 'No Flomo memos matched the requested filters.');
    }
    return body.data.map(normalizeMemo);
  },
});

export const __test__ = {
  buildSignedUrl,
  command,
  normalizeMemo,
  parsePositiveIntArg,
  parseSinceArg,
  parseSlugArg,
};
