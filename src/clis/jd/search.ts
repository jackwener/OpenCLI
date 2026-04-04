/**
 * 京东商品搜索 — browser cookie，解析搜索结果列表中的标题与价格。
 *
 * 依赖: Chrome 已登录京东（与 jd item 相同）
 * 用法: opencli jd search
 *       opencli jd search "显卡 A100"
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'jd',
  name: 'search',
  description: '京东商品搜索（标题、价格、链接）',
  domain: 'search.jd.com',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'query',
      positional: true,
      default: '显卡 A100',
      help: '搜索关键词（默认：显卡 A100）',
    },
    { name: 'limit', type: 'int', default: 30, help: '最多返回条数' },
  ],
  columns: ['rank', 'title', 'price', 'sku', 'url'],
  func: async (page, kwargs, debug) => {
    const query = String(kwargs.query ?? '显卡 A100').trim();
    const limit = Math.max(1, Math.min(60, Number(kwargs.limit) || 30));
    const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}&enc=utf-8`;

    await page.goto(url, { waitUntil: 'load', settleMs: 4000 });
    await page.wait(2);

    for (const sel of ['li.gl-item', '#J_goodsList li.gl-item', 'a[href*="item.jd.com"]']) {
      try {
        await page.wait({ selector: sel, timeout: 20 });
        break;
      } catch {
        /* try next */
      }
    }

    await page.autoScroll({ times: 5, delayMs: 700 });
    await page.wait(1.5);

    const data = await page.evaluate(`
      (() => {
        const limit = ${limit};

        const skuFromHref = (href) => {
          if (!href) return '';
          const m = String(href).match(/item\\.jd\\.com\\/(\\d+)\\.html/);
          return m ? m[1] : '';
        };

        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

        const absHref = (href) => {
          if (!href) return '';
          if (href.startsWith('http')) return href;
          if (href.startsWith('//')) return 'https:' + href;
          return 'https:' + href;
        };

        const priceFromLi = (li) => {
          const priceEl =
            li.querySelector('.p-price i') ||
            li.querySelector('.p-price .J_price') ||
            li.querySelector('.p-price .price') ||
            li.querySelector('.p-price [class*="price"]') ||
            li.querySelector('.p-price') ||
            li.querySelector('[class*="p-price"]');
          let price = '';
          if (priceEl) {
            price = clean(priceEl.textContent || '');
            if (!price) {
              const parent = li.querySelector('.p-price') || li.querySelector('[class*="p-price"]');
              if (parent) price = clean(parent.innerText || '');
            }
          }
          return price;
        };

        const rowSelectors = [
          '#J_goodsList li.gl-item',
          '#J_goodsList .gl-item',
          'ul#J_goodsList li.gl-item',
          '.goods-list-v2 li[data-sku]',
          'li.gl-item',
          'div.gl-item',
          '.gl-item',
        ];

        let nodes = [];
        for (const sel of rowSelectors) {
          const found = document.querySelectorAll(sel);
          if (found.length) {
            nodes = Array.from(found);
            break;
          }
        }

        const results = [];
        const seen = new Set();

        const pushRow = (li, nameEl) => {
          if (results.length >= limit) return;
          const href = nameEl.getAttribute('href') || '';
          const absUrl = absHref(href);
          const sku = (li && li.getAttribute && li.getAttribute('data-sku')) || skuFromHref(href);
          const dedupeKey = sku || absUrl;
          if (!dedupeKey || seen.has(dedupeKey)) return;
          seen.add(dedupeKey);

          const title = clean(
            nameEl.getAttribute('title') || nameEl.textContent || ''
          );
          if (!title || title.length < 2) return;

          const price = li ? priceFromLi(li) : '';

          results.push({
            rank: results.length + 1,
            title,
            price: price || '—',
            sku: sku || '',
            url: absUrl,
          });
        };

        for (const li of nodes) {
          if (results.length >= limit) break;
          const nameEl = li.querySelector('.p-name a')
            || li.querySelector('.p-name-type-2 a')
            || li.querySelector('h3 a[href*="item.jd.com"]')
            || li.querySelector('a[href*="item.jd.com"]');
          if (!nameEl) continue;
          pushRow(li, nameEl);
        }

        if (results.length < limit) {
          const anchors = Array.from(document.querySelectorAll('a[href*="item.jd.com"]'));
          for (const a of anchors) {
            if (results.length >= limit) break;
            const href = a.getAttribute('href') || '';
            const sku = skuFromHref(href);
            if (!sku) continue;
            if (seen.has(sku)) continue;
            const title = clean(a.getAttribute('title') || a.textContent || '');
            if (!title || title.length < 2) continue;
            seen.add(sku);
            const li = a.closest('li') || a.closest('.gl-item') || a.closest('[data-sku]') || a.parentElement;
            const price = li ? priceFromLi(li) : '';
            results.push({
              rank: results.length + 1,
              title,
              price: price || '—',
              sku,
              url: absHref(href),
            });
          }
        }

        return results;
      })()
    `);

    if (!Array.isArray(data)) return [];

    if (data.length === 0 && debug) {
      const diag = await page.evaluate(`
        (() => {
          const u = location.href || '';
          const t = document.title || '';
          const gl = document.querySelectorAll('li.gl-item, .gl-item').length;
          const links = document.querySelectorAll('a[href*="item.jd.com"]').length;
          const body = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 400) : '';
          return { url: u, title: t, glItemCount: gl, itemLinkCount: links, bodyPreview: body };
        })()
      `);
      console.error('[opencli:jd:search] 未解析到商品，页面诊断:', JSON.stringify(diag, null, 2));
    }

    return data;
  },
});
