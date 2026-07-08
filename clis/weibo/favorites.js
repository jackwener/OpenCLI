import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getSelfUid, requireArrayEvaluateResult, unwrapEvaluateResult } from './utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePositiveInt(value, name, defaultValue) {
  const raw = value ?? defaultValue;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    throw new ArgumentError(`weibo favorites ${name} must be a positive integer`);
  }
  if (number > MAX_LIMIT) {
    throw new ArgumentError(`weibo favorites ${name} must be <= ${MAX_LIMIT}`);
  }
  return number;
}

function parseFavoriteCard(card, favUrl) {
  const raw = String(card?.text ?? '');
  const lines = raw.split('\n');

  let author = '';
  let time = '';
  let source = '';
  let content = '';
  let likes = '0';
  let comments = '0';
  let reposts = '0';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t === '添加') continue;

    if (!time && /\d+小时前|\d+分钟前|\d+秒前|昨天|前天|\d{1,2}:\d{2}/.test(t)) {
      time = t;
      continue;
    }

    if (t.startsWith('来自')) {
      source = t;
      continue;
    }

    if (content) {
      const n = Number.parseInt(t, 10);
      if (!Number.isNaN(n) && n > 0 && n < 1_000_000 && t === String(n)) {
        if (likes === '0') likes = t;
        else if (comments === '0') comments = t;
        else if (reposts === '0') reposts = t;
        continue;
      }
    }

    if (!author && t.length < 40) {
      author = t;
      continue;
    }

    if (!content && author) {
      content = t;
      continue;
    }

    if (content) content += ` ${t}`;
  }

  if (!content || !author) return null;

  return {
    author,
    text: content.substring(0, 300),
    time,
    source,
    likes,
    comments,
    reposts,
    url: card?.url || favUrl,
  };
}

function dedupeFavorites(items, favUrl) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.url && item.url !== favUrl
      ? item.url
      : `${item.author}\n${item.text}\n${item.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

cli({
  site: 'weibo',
  name: 'favorites',
    access: 'read',
  description: '我的微博收藏列表',
  domain: 'weibo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '数量（最多50）' },
  ],
  columns: ['author', 'text', 'time', 'source', 'likes', 'comments', 'reposts', 'url'],
  func: async (page, kwargs) => {
    const limit = parsePositiveInt(kwargs.limit, 'limit', DEFAULT_LIMIT);

    await page.goto('https://weibo.com');
    await page.wait(2);

    const uid = await getSelfUid(page);

    const favUrl = 'https://www.weibo.com/u/page/fav/' + uid;

    await page.goto(favUrl);
    await page.wait(4);

    for (let i = 0; i < 3; i++) {
      await page.evaluate('() => window.scrollBy(0, 800)');
      await page.wait(1);
    }

    const rawData = requireArrayEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
      (() => {
        const scrollers = document.querySelectorAll('.wbpro-scroller-item, .vue-recycle-scroller__item-view');
        const out = [];
        for (const s of scrollers) {
          // Use textContent to preserve newlines, then split by \n
          const bodyEl = s.querySelector('[class*="_body_"]') || s.querySelector('.wbpro-item-body') || s;
          // innerText preserves newlines between block elements (unlike textContent)
          const rawText = bodyEl.innerText || s.innerText || '';

          let postUrl = '';
          const anchors = s.querySelectorAll('a[href]');
          for (const a of anchors) {
            const m = String(a.href).match(/weibo\\.com\\/(\\d+)\\/([a-zA-Z0-9]+)/);
            if (m) { postUrl = 'https://weibo.com/' + m[1] + '/' + m[2]; break; }
          }

          if (rawText.length > 20) out.push({ text: rawText, url: postUrl });
          if (out.length >= ${limit}) break;
        }
        return out;
      })()
    `)), 'weibo favorites');

    if (rawData.length === 0) {
      throw new EmptyResultError('weibo favorites', 'No favorites were visible on the favorites page');
    }

    const items = rawData
      .map(card => parseFavoriteCard(card, favUrl))
      .filter(Boolean);

    const uniqueItems = dedupeFavorites(items, favUrl);
    if (uniqueItems.length === 0) {
      throw new CommandExecutionError('Failed to parse visible Weibo favorites');
    }
    return uniqueItems.slice(0, limit);
  },
});

export const __test__ = {
  parseFavoriteCard,
  parsePositiveInt,
  dedupeFavorites,
};
