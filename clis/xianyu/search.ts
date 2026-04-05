import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const MAX_LIMIT = 50;

function normalizeLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

function buildSearchUrl(query: string): string {
  return `https://www.goofish.com/search?q=${encodeURIComponent(query)}`;
}

function itemIdFromUrl(url: string): string {
  const match = url.match(/[?&]id=(\d+)/);
  return match ? match[1] : '';
}

function buildExtractResultsEvaluate(limit: number): string {
  return `
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeoutMs = 8000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await wait(150);
        }
        return false;
      };

      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const selectors = {
        card: 'a[href*="/item?id="]',
        title: '[class*="row1-wrap-title"], [class*="main-title"]',
        attrs: '[class*="row2-wrap-cpv"] span[class*="cpv--"]',
        priceWrap: '[class*="price-wrap"]',
        priceNum: '[class*="number"]',
        priceDec: '[class*="decimal"]',
        priceDesc: '[class*="price-desc"] [title], [class*="price-desc"] [style*="line-through"]',
        sellerWrap: '[class*="row4-wrap-seller"]',
        sellerText: '[class*="seller-text"]',
        badge: '[class*="credit-container"] [title], [class*="credit-container"] span',
      };

      await waitFor(() => {
        const bodyText = document.body?.innerText || '';
        return Boolean(
          document.querySelector(selectors.card)
          || /请先登录|登录后|验证码|安全验证|异常访问/.test(bodyText)
          || /暂无相关宝贝|未找到相关宝贝|没有找到/.test(bodyText)
        );
      });

      const bodyText = document.body?.innerText || '';
      const requiresAuth = /请先登录|登录后/.test(bodyText);
      const blocked = /验证码|安全验证|异常访问/.test(bodyText);
      const empty = /暂无相关宝贝|未找到相关宝贝|没有找到/.test(bodyText);

      const items = Array.from(document.querySelectorAll(selectors.card))
        .slice(0, ${limit})
        .map((card) => {
          const href = card.href || card.getAttribute('href') || '';
          const title = clean(card.querySelector(selectors.title)?.textContent || '');
          const attrs = Array.from(card.querySelectorAll(selectors.attrs))
            .map((node) => clean(node.textContent || ''))
            .filter(Boolean);
          const priceWrap = card.querySelector(selectors.priceWrap);
          const priceNumber = clean(priceWrap?.querySelector(selectors.priceNum)?.textContent || '');
          const priceDecimal = clean(priceWrap?.querySelector(selectors.priceDec)?.textContent || '');
          const location = clean(card.querySelector(selectors.sellerWrap)?.querySelector(selectors.sellerText)?.textContent || '');
          const originalPriceNode = card.querySelector(selectors.priceDesc);
          const badgeNode = card.querySelector(selectors.badge);

          return {
            title,
            url: href,
            item_id: '',
            price: clean('¥' + priceNumber + priceDecimal).replace(/^¥\\s*$/, ''),
            original_price: clean(originalPriceNode?.getAttribute('title') || originalPriceNode?.textContent || ''),
            condition: attrs[0] || '',
            brand: attrs[1] || '',
            extra: attrs.slice(2).join(' | '),
            location,
            badge: clean(badgeNode?.getAttribute('title') || badgeNode?.textContent || ''),
          };
        })
        .filter((item) => item.title && item.url);

      return { requiresAuth, blocked, empty, items };
    })()
  `;
}

cli({
  site: 'xianyu',
  name: 'search',
  description: '搜索闲鱼商品',
  domain: 'www.goofish.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return' },
  ],
  columns: ['item_id', 'rank', 'title', 'price', 'condition', 'brand', 'location', 'badge', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    const limit = normalizeLimit(kwargs.limit);

    await page.goto(buildSearchUrl(query));
    await page.wait(2);
    await page.autoScroll({ times: 2 });

    const payload = await page.evaluate(buildExtractResultsEvaluate(limit)) as {
      requiresAuth?: boolean;
      blocked?: boolean;
      empty?: boolean;
      items?: Array<Record<string, string>>;
    };

    if (payload?.requiresAuth) {
      throw new AuthRequiredError('www.goofish.com', 'Xianyu search results require a logged-in browser session');
    }

    if (payload?.blocked) {
      throw new EmptyResultError('xianyu search', 'Xianyu returned a verification page or blocked the current browser session');
    }

    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length && !payload?.empty) {
      throw new EmptyResultError('xianyu search', 'No item cards were found on the current Xianyu search page');
    }

    return items.map((item, index) => ({
      rank: index + 1,
      ...item,
      item_id: itemIdFromUrl(item.url),
    }));
  },
});

export const __test__ = {
  MAX_LIMIT,
  normalizeLimit,
  buildSearchUrl,
  itemIdFromUrl,
};
