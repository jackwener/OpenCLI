import { cli, Strategy } from '../../src/registry.js';
import { mergeSearchItems, normalizeSearchItem, sanitizeSearchItems } from './utils.js';

function escapeJsString(value: string): string {
  return JSON.stringify(value);
}

function buildApplyFilterEvaluate(filter: string): string {
  return `
    () => {
      const filter = ${escapeJsString(filter)};
      const labels = Array.from(document.querySelectorAll('label'));
      const normalize = (value) => (value == null ? '' : String(value).trim().toLowerCase());
      const target = labels.find((label) => {
        const component = normalize(label.getAttribute('data-component-name'));
        const imgAlt = normalize(label.querySelector('img')?.getAttribute('alt'));
        const text = normalize(label.textContent);

        if (filter === 'rocket') {
          return (
            component.includes('deliveryfilteroption-rocket_luxury,rocket_wow,coupang_global') ||
            imgAlt.includes('rocket_luxury,rocket_wow,coupang_global') ||
            imgAlt.includes('rocket-all') ||
            text.includes('로켓')
          );
        }

        return component.includes(filter) || imgAlt.includes(filter) || text.includes(filter);
      });

      if (!target) {
        return { ok: false, reason: 'FILTER_NOT_FOUND' };
      }

      target.click();

      return {
        ok: true,
        reason: 'FILTER_CLICKED',
        component: target.getAttribute('data-component-name') || '',
        text: (target.textContent || '').trim(),
        alt: target.querySelector('img')?.getAttribute('alt') || '',
      };
    }
  `;
}

function buildCurrentLocationEvaluate(): string {
  return `
    () => ({
      href: location.href
    })
  `;
}

function buildSearchEvaluate(query: string, limit: number, pageNumber: number): string {
  return `
    (async () => {
      const query = ${escapeJsString(query)};
      const limit = ${limit};
      const pageNumber = ${pageNumber};

      const normalizeText = (value) => (value == null ? '' : String(value).trim());
      const parseNum = (value) => {
        const text = normalizeText(value).replace(/[^\\d.]/g, '');
        if (!text) return null;
        const num = Number(text);
        return Number.isFinite(num) ? num : null;
      };
      const extractPriceFromText = (text) => {
        const matches = normalizeText(text).match(/\\d{1,3}(?:,\\d{3})*원/g) || [];
        if (!matches.length) return '';
        if (matches.length >= 2) return matches[matches.length - 2];
        return matches[0];
      };
      const extractPriceInfo = (root) => {
        const priceArea =
          root.querySelector('.PriceArea_priceArea__NntJz, [class*="PriceArea_priceArea"], [class*="priceArea"]') ||
          root;
        const priceAreaText = normalizeText(priceArea.textContent || '');
        const originalPrice = normalizeText(
          priceArea.querySelector(
            'del, .base-price, .origin-price, .original-price, .strike-price, [class*="base-price"], [class*="origin-price"], [class*="line-through"]'
          )?.textContent || ''
        );
        const originalPriceNum = parseNum(originalPrice);
        const unitPrice =
          normalizeText(
            priceArea.querySelector('.unit-price, [class*="unit-price"], [class*="unitPrice"]')?.textContent || ''
          ) ||
          priceAreaText.match(/\\([^)]*당\\s*[^)]*원[^)]*\\)/)?.[0] ||
          '';

        const candidates = Array.from(priceArea.querySelectorAll('span, strong, div'))
          .map((node) => {
            const text = normalizeText(node.textContent || '');
            if (!text || !/\\d/.test(text)) return null;
            if (/\\d{1,2}:\\d{2}:\\d{2}/.test(text)) return null;
            if (/당\\s*\\d/.test(text)) return null;
            if (/^\\d+%$/.test(text)) return null;

            const num = parseNum(text);
            if (num == null) return null;

            const className = normalizeText(node.getAttribute('class') || '').toLowerCase();
            let score = 0;
            if (/price|sale|selling|final/.test(className)) score += 6;
            if (/red/.test(className)) score += 5;
            if (/font-bold|bold/.test(className)) score += 3;
            if (/line-through/.test(className)) score -= 12;
            if (text.includes('원')) score += 2;
            if (originalPriceNum != null && num === originalPriceNum) score -= 10;
            if (num < 100) score -= 10;

            return { text, num, score };
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (originalPriceNum != null) {
              const aPrefer = a.num !== originalPriceNum ? 1 : 0;
              const bPrefer = b.num !== originalPriceNum ? 1 : 0;
              if (bPrefer !== aPrefer) return bPrefer - aPrefer;
            }
            return b.num - a.num;
          });

        const currentPrice =
          normalizeText(candidates.find((candidate) => candidate.num !== originalPriceNum)?.text || '') ||
          normalizeText(candidates[0]?.text || '') ||
          extractPriceFromText(priceAreaText) ||
          '';

        return {
          price: currentPrice,
          originalPrice,
          unitPrice,
        };
      };
      const canonicalUrl = (url, productId) => {
        if (url) {
          try {
            const parsed = new URL(url, 'https://www.coupang.com');
            const match = parsed.pathname.match(/\\/vp\\/products\\/(\\d+)/);
            return 'https://www.coupang.com/vp/products/' + (match?.[1] || productId || '');
          } catch {}
        }
        return productId ? 'https://www.coupang.com/vp/products/' + productId : '';
      };
        const normalize = (raw) => {
          const rawText = normalizeText(raw.text || raw.badgeText || raw.deliveryText || raw.summary);
        const productId = normalizeText(
          raw.productId || raw.product_id || raw.id || raw.productNo ||
          raw?.product?.productId || raw?.item?.id
        ).match(/(\\d{6,})/)?.[1] || '';
        const title = normalizeText(
          raw.title || raw.name || raw.productName || raw.productTitle || raw.itemName
        );
        const price = parseNum(raw.price || raw.salePrice || raw.finalPrice || raw.sellingPrice);
        const originalPrice = parseNum(raw.originalPrice || raw.basePrice || raw.listPrice || raw.originPrice);
        const unitPrice = normalizeText(raw.unitPrice || raw.unit_price || raw.unitPriceText);
        const rating = parseNum(raw.rating || raw.star || raw.reviewRating);
        const reviewCount = parseNum(raw.reviewCount || raw.ratingCount || raw.reviewCnt || raw.reviews);
        const badge = Array.isArray(raw.badges) ? raw.badges.map(normalizeText).filter(Boolean).join(', ') : normalizeText(raw.badge || raw.labels);
        const seller = normalizeText(raw.seller || raw.sellerName || raw.vendorName || raw.merchantName);
        const category = normalizeText(raw.category || raw.categoryName || raw.categoryPath);
        const discountRate = parseNum(raw.discountRate || raw.discount || raw.discountPercent);
        const url = canonicalUrl(raw.url || raw.productUrl || raw.link, productId);
        return {
          productId,
          title,
          price,
          originalPrice,
          unitPrice,
          discountRate,
          rating,
          reviewCount,
          rocket: normalizeText(raw.rocket || raw.rocketType),
          deliveryType: normalizeText(raw.deliveryType || raw.deliveryBadge || raw.shippingType || raw.shippingBadge),
          deliveryPromise: normalizeText(raw.deliveryPromise || raw.promise || raw.arrivalText || raw.arrivalBadge),
          seller,
          badge,
          category,
          url,
        };
      };

      const byApi = async () => {
        const candidates = [
          '/np/search?q=' + encodeURIComponent(query) + '&component=&channel=user&page=' + pageNumber,
          '/np/search?component=&q=' + encodeURIComponent(query) + '&channel=user&page=' + pageNumber,
        ];

        for (const path of candidates) {
          try {
            const resp = await fetch(path, { credentials: 'include' });
            if (!resp.ok) continue;
            const text = await resp.text();
            const data = text.trim().startsWith('<') ? null : JSON.parse(text);
            const maybeItems =
              data?.data?.products ||
              data?.data?.productList ||
              data?.products ||
              data?.productList ||
              data?.items;
            if (Array.isArray(maybeItems) && maybeItems.length) {
              return maybeItems.slice(0, limit).map(normalize);
            }
          } catch {}
        }
        return [];
      };

      const byBootstrap = () => {
        const isProductLike = (item) => {
          if (!item || typeof item !== 'object') return false;
          const values = [item.productId, item.product_id, item.id, item.productNo, item.url, item.productUrl, item.link, item.title, item.productName];
          return values.some((value) => /\\/vp\\/products\\/|\\d{6,}/.test(normalizeText(value)));
        };

        const collectProducts = (node) => {
          const queue = [node];
          while (queue.length) {
            const current = queue.shift();
            if (!current || typeof current !== 'object') continue;
            if (Array.isArray(current)) {
              const productish = current.filter(isProductLike);
              if (productish.length >= 3) return productish.slice(0, limit).map(normalize);
              queue.push(...current.slice(0, 50));
              continue;
            }
            for (const value of Object.values(current)) queue.push(value);
          }
          return [];
        };

        const scriptNodes = Array.from(document.scripts);
        for (const script of scriptNodes) {
          const text = script.textContent || '';
          if (!text || !/product|search/i.test(text)) continue;
          const arrayMatches = [
            ...text.matchAll(/"products?"\\s*:\\s*(\\[[\\s\\S]{100,}?\\])/g),
            ...text.matchAll(/"itemList"\\s*:\\s*(\\[[\\s\\S]{100,}?\\])/g),
          ];
          for (const match of arrayMatches) {
            try {
              const products = JSON.parse(match[1]);
              if (Array.isArray(products) && products.length) {
                return products.slice(0, limit).map(normalize);
              }
            } catch {}
          }
        }

        const globals = [
          window.__NEXT_DATA__,
          window.__APOLLO_STATE__,
          window.__INITIAL_STATE__,
          window.__STATE__,
          window.__PRELOADED_STATE__,
        ];
        for (const candidate of globals) {
          if (!candidate || typeof candidate !== 'object') continue;
          const found = collectProducts(candidate);
          if (found.length) return found;
        }
        return [];
      };

      const byJsonLd = () => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
          const text = script.textContent || '';
          if (!text) continue;
          try {
            const payload = JSON.parse(text);
            const docs = Array.isArray(payload) ? payload : [payload];
            for (const doc of docs) {
              const items =
                doc?.itemListElement ||
                doc?.about?.itemListElement ||
                doc?.mainEntity?.itemListElement ||
                [];
              if (!Array.isArray(items) || !items.length) continue;
              const mapped = items.map((entry) => {
                const item = entry?.item || entry;
                return normalize({
                  productId: item?.url || item?.sku || item?.productID,
                  title: item?.name,
                  price: item?.offers?.price,
                  originalPrice: item?.offers?.highPrice,
                  rating: item?.aggregateRating?.ratingValue,
                  reviewCount: item?.aggregateRating?.reviewCount,
                  seller: item?.offers?.seller?.name,
                  badge: item?.offers?.availability,
                  category: item?.category,
                  url: item?.url,
                });
              }).filter((item) => item.productId || item.url || item.title);
              if (mapped.length) return mapped.slice(0, limit);
            }
          } catch {}
        }
        return [];
      };

      const byDom = () => {
        const domScanLimit = Math.max(limit * 6, 60);
        const cards = Array.from(new Set([
          ...document.querySelectorAll('li.search-product'),
          ...document.querySelectorAll('li[class*="search-product"], div[class*="search-product"], article[class*="search-product"]'),
          ...document.querySelectorAll('li[class*="ProductUnit_productUnit"], [class*="ProductUnit_productUnit"]'),
          ...document.querySelectorAll('.impression-logged, [class*="promotion-item"], [class*="product-item"]'),
          ...document.querySelectorAll('[data-product-id]'),
          ...document.querySelectorAll('[data-id]'),
          ...document.querySelectorAll('a[href*="/vp/products/"]'),
        ])).slice(0, domScanLimit);
        const items = [];
        for (const el of cards) {
          const root = el.closest('li, div, article, section') || el;
          const html = root.innerHTML || '';
          const priceInfo = extractPriceInfo(root);
          const badgeImages = Array.from(root.querySelectorAll('img[data-badge-id]'));
          const badgeIds = badgeImages
            .map((node) => node.getAttribute('data-badge-id') || '')
            .filter(Boolean);
          const badgeSrcText = badgeImages
            .map((node) => (node.getAttribute('data-badge-id') || '') + ' ' + (node.getAttribute('src') || ''))
            .join(' ');
          const productId =
            root.getAttribute('data-product-id') ||
            el.getAttribute('data-product-id') ||
            root.querySelector('a[href*="/vp/products/"]')?.getAttribute('data-product-id') ||
            root.querySelector('a[href*="/vp/products/"]')?.getAttribute('href')?.match(/\\/vp\\/products\\/(\\d+)/)?.[1] ||
            html.match(/\\/vp\\/products\\/(\\d+)/)?.[1] ||
            (el.getAttribute('href') || '').match(/\\/vp\\/products\\/(\\d+)/)?.[1] ||
            '';
          const title =
            root.querySelector('.name, .title, .product-name, .search-product-title, .item-title, .ProductUnit_productNameV2__cV9cw, [class*="ProductUnit_productName"], [class*="productName"], [class*="product-name"], [class*="title"]')?.textContent ||
            root.querySelector('img[alt]')?.getAttribute('alt') ||
            html.match(/alt="([^"]+)"/)?.[1] ||
            (root.textContent || '').replace(/\\s+/g, ' ').trim().match(/^(.+?)(\\d{1,3},\\d{3}원|무료배송|내일\\(|오늘\\(|새벽)/)?.[1] ||
            el.getAttribute('title') ||
            '';
          const price = priceInfo.price || '';
          const originalPrice = priceInfo.originalPrice || '';
          const unitPrice = priceInfo.unitPrice || '';
          const rating =
            root.querySelector('.rating, .star em, [class*="rating"], [class*="star"], [class*="ProductRating"] [aria-label], [aria-label][class*="ProductRating"]')?.getAttribute?.('aria-label') ||
            root.querySelector('.rating, .star em, [class*="rating"], [class*="star"], [class*="ProductRating"]')?.textContent ||
            '';
          const reviewCount =
            root.querySelector('.rating-total-count, .count, .review-count, .promotion-item-review-count, [class*="review"], [class*="count"], [class*="ProductRating"] span, [class*="ProductRating"] [class*="fw-text"]')?.textContent ||
            '';
          const seller =
            root.querySelector('.seller, .vendor, .search-product-wrap .vendor-name, [class*="vendor"], [class*="seller"]')?.textContent ||
            '';
          const category =
            root.getAttribute('data-category') ||
            root.querySelector('[class*="category"]')?.textContent ||
            '';
          const text = (root.textContent || '').replace(/\\s+/g, ' ').trim();
          const badgeNodes = Array.from(root.querySelectorAll('.badge, .delivery, .tag, .icon-service, .pdd-text, .delivery-text, [class*="badge"], [class*="delivery"]'));
          const hrefNode = root.querySelector('a[href*="/vp/products/"]');
          items.push(normalize({
            productId,
            title,
            price,
            originalPrice,
            unitPrice,
            rating,
            reviewCount,
            seller,
            badges: [...badgeIds, ...badgeNodes.map((node) => node.textContent || '').filter(Boolean)],
            rocket: badgeSrcText + ' ' + badgeNodes.map((node) => node.textContent || '').join(' '),
            deliveryType: badgeNodes.map((node) => node.textContent || '').join(' ') + ' ' + text,
            deliveryPromise: badgeNodes.map((node) => node.textContent || '').join(' ') + ' ' + text,
            category,
            text,
            url: hrefNode?.getAttribute('href') || '',
          }));
        }
        return items.slice(0, domScanLimit);
      };

      let items = await byApi();
      if (!items.length) items = byJsonLd();
      if (!items.length) items = byBootstrap();
      const domItems = byDom();
      if (!items.length) items = domItems;

      return {
        loginHints: {
          hasLoginLink: Boolean(document.querySelector('a[href*="login"], a[title*="로그인"]')),
          hasMyCoupang: /마이쿠팡/.test(document.body.innerText),
        },
        items,
        domItems,
      };
    })()
  `;
}

cli({
  site: 'coupang',
  name: 'search',
  description: 'Search Coupang products with logged-in browser session',
  domain: 'www.coupang.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'page', type: 'int', default: 1, help: 'Search result page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (max 50)' },
    { name: 'filter', required: false, help: 'Optional search filter (currently supports: rocket)' },
  ],
  columns: ['rank', 'title', 'price', 'unit_price', 'rating', 'review_count', 'rocket', 'delivery_type', 'delivery_promise', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query || '').trim();
    const pageNumber = Math.max(Number(kwargs.page || 1), 1);
    const limit = Math.min(Math.max(Number(kwargs.limit || 20), 1), 50);
    const filter = String(kwargs.filter || '').trim().toLowerCase();
    if (!query) throw new Error('Query is required');

    const initialPage = filter ? 1 : pageNumber;
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}&channel=user&page=${initialPage}`;
    await page.goto(url);
    if (filter) {
      const filterResult = await page.evaluate(buildApplyFilterEvaluate(filter));
      if (!filterResult?.ok) {
        throw new Error(`Unsupported or unavailable filter: ${filter}`);
      }
      await page.wait(3);
      if (pageNumber > 1) {
        const locationInfo = await page.evaluate(buildCurrentLocationEvaluate());
        const filteredUrl = new URL(locationInfo?.href || url);
        filteredUrl.searchParams.set('page', String(pageNumber));
        await page.goto(filteredUrl.toString());
      }
    }
    await page.autoScroll({ times: filter ? 3 : 2, delayMs: 1500 });

    const raw = await page.evaluate(buildSearchEvaluate(query, limit, pageNumber));
    const loginHints = raw?.loginHints ?? {};
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const domItems = Array.isArray(raw?.domItems) ? raw.domItems : [];
    const normalizedBase = sanitizeSearchItems(
      items.map((item: Record<string, unknown>, index: number) => normalizeSearchItem(item, index)),
      limit
    );
    const normalizedDom = sanitizeSearchItems(
      domItems.map((item: Record<string, unknown>, index: number) => normalizeSearchItem(item, index)),
      Math.max(limit * 6, 60)
    );
    const normalized = filter
      ? sanitizeSearchItems(normalizedDom, limit)
      : mergeSearchItems(normalizedBase, normalizedDom, limit);

    if (!normalized.length && loginHints.hasLoginLink && !loginHints.hasMyCoupang) {
      throw new Error('Coupang login required. Please log into Coupang in Chrome and retry.');
    }
    return normalized;
  },
});
