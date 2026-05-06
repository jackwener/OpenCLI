import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { canonicalizeProductUrl, normalizeProductId, requireProductIdArg } from './utils.js';

function escapeJsString(value) {
    return JSON.stringify(value);
}

/**
 * Build the in-page extractor for a Coupang product detail page.
 *
 * Tries three sources in order, mirroring search.js's chain:
 *  1. JSON-LD <script type="application/ld+json"> (Product schema, most stable)
 *  2. window.__INITIAL_STATE__ / __NEXT_DATA__ / similar globals (rich)
 *  3. DOM scrape (fallback when bootstrap state is server-side only)
 *
 * Returns either a partial product object or a structured failure
 * `{ loginHints, ok: false, reason }` so the caller can map it to typed errors.
 *
 * Design note (no-silent-empty): empty strings / null fields here MUST mean
 * "upstream did not provide this field" — they should not be conflated with
 * "extraction failed". A failed extraction returns ok=false so the caller can
 * surface AuthRequiredError or EmptyResultError; partial success returns the
 * fields it found and the caller decides whether to treat the partial row as
 * usable.
 */
function buildProductDetailEvaluate(expectedProductId) {
    return `
    (async () => {
      const expectedProductId = ${escapeJsString(expectedProductId)};
      const normalizeText = (value) => (value == null ? '' : String(value).trim());
      const parseNum = (value) => {
        const text = normalizeText(value).replace(/[^\\d.]/g, '');
        if (!text) return null;
        const num = Number(text);
        return Number.isFinite(num) ? num : null;
      };

      const loginHints = {
        hasLoginLink: Boolean(document.querySelector('a[href*="login"], a[title*="로그인"]')),
        hasMyCoupang: /마이쿠팡/.test(document.body.innerText || ''),
      };

      const pathMatch = location.pathname.match(/\\/vp\\/products\\/(\\d+)/);
      const currentProductId = pathMatch?.[1] || '';
      if (expectedProductId && currentProductId && expectedProductId !== currentProductId) {
        return { ok: false, reason: 'PRODUCT_MISMATCH', currentProductId, loginHints };
      }

      // ── Source 1: JSON-LD Product schema ─────────────────────────────
      const fromJsonLd = (() => {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const script of scripts) {
          try {
            const docs = JSON.parse(script.textContent || 'null');
            const items = Array.isArray(docs) ? docs : [docs];
            for (const doc of items) {
              if (!doc || typeof doc !== 'object') continue;
              const t = doc['@type'];
              const types = Array.isArray(t) ? t : [t];
              if (!types.some((x) => /Product/i.test(String(x || '')))) continue;
              const offers = Array.isArray(doc.offers) ? doc.offers[0] : doc.offers;
              return {
                title: normalizeText(doc.name),
                brand: normalizeText(doc.brand?.name || doc.brand),
                image_url: normalizeText(Array.isArray(doc.image) ? doc.image[0] : doc.image),
                price: parseNum(offers?.price),
                rating: parseNum(doc.aggregateRating?.ratingValue),
                review_count: parseNum(doc.aggregateRating?.reviewCount),
                seller: normalizeText(offers?.seller?.name),
              };
            }
          } catch { /* malformed ld+json — skip and try next source */ }
        }
        return null;
      })();

      // ── Source 2: bootstrap globals (deeply nested vendorItem etc.) ──
      const fromBootstrap = (() => {
        const collect = (root) => {
          if (!root || typeof root !== 'object') return null;
          const queue = [root];
          let depth = 0;
          while (queue.length && depth < 5000) {
            const node = queue.shift();
            depth++;
            if (!node || typeof node !== 'object') continue;
            // A product-like leaf usually has both productId and salePrice / finalPrice / itemName.
            const idCandidate = node.productId || node.product_id || node.id;
            const titleCandidate = node.itemName || node.productName || node.name;
            const priceCandidate = node.salePrice ?? node.finalPrice ?? node.sellingPrice ?? node.price;
            if (idCandidate && titleCandidate && priceCandidate != null && /\\d{6,}/.test(String(idCandidate))) {
              return {
                product_id: String(idCandidate),
                title: normalizeText(titleCandidate),
                price: parseNum(priceCandidate),
                original_price: parseNum(node.originalPrice ?? node.basePrice ?? node.listPrice),
                discount_rate: parseNum(node.discountRate ?? node.discountPercent),
                rating: parseNum(node.ratingAverage ?? node.rating ?? node.reviewRating),
                review_count: parseNum(node.reviewCount ?? node.reviewsCount ?? node.ratingCount),
                seller: normalizeText(node.vendorName ?? node.sellerName ?? node.merchantName),
                brand: normalizeText(node.brandName ?? node.brand),
                rocket: normalizeText(node.rocketType ?? node.deliveryBadgeType),
                delivery_promise: normalizeText(node.deliveryPromise ?? node.arrivalText),
              };
            }
            for (const value of Object.values(node)) {
              if (value && typeof value === 'object') queue.push(value);
            }
          }
          return null;
        };
        const candidates = [
          window.__INITIAL_STATE__,
          window.__NEXT_DATA__,
          window.__APOLLO_STATE__,
          window.__PRELOADED_STATE__,
        ];
        for (const c of candidates) {
          const found = collect(c);
          if (found) return found;
        }
        return null;
      })();

      // ── Source 3: DOM fallback ───────────────────────────────────────
      const fromDom = (() => {
        const titleNode = document.querySelector(
          '.prod-buy-header__title, h1.prod-buy-header__title, h1[class*="prod-buy-header"], h2.prod-buy-header__title, h1[class*="ProductName"], h1[class*="product-name"]'
        );
        const priceNode = document.querySelector(
          '.total-price strong, .prod-sale-price strong, [class*="finalPrice"], [class*="sellingPrice"], [class*="price-value"]'
        );
        const originalPriceNode = document.querySelector(
          '.origin-price, .base-price, del[class*="origin"], del[class*="base"], [class*="strike"], [class*="origin-price"]'
        );
        const discountNode = document.querySelector(
          '.discount-percentage, [class*="discount"][class*="percent"], [class*="discountRate"]'
        );
        const ratingNode = document.querySelector(
          '.rating-star-num, [class*="ratingStar"], [class*="rating-star"], [class*="rating-num"], [class*="ProductRating"]'
        );
        const reviewCountNode = document.querySelector(
          '.count, .rating-total-count, [class*="reviewCount"], [class*="review-count"]'
        );
        const sellerNode = document.querySelector(
          '.prod-sale-vendor-name, [class*="vendor-name"], [class*="vendorName"], [class*="sellerName"]'
        );
        const imageNode = document.querySelector(
          '.prod-image__detail, [class*="prod-image"] img, [class*="ProductImage"] img'
        );
        return {
          title: normalizeText(titleNode?.textContent),
          price: parseNum(priceNode?.textContent),
          original_price: parseNum(originalPriceNode?.textContent),
          discount_rate: parseNum(discountNode?.textContent),
          rating: parseNum(ratingNode?.getAttribute?.('aria-label') || ratingNode?.textContent),
          review_count: parseNum(reviewCountNode?.textContent),
          seller: normalizeText(sellerNode?.textContent),
          image_url: normalizeText(imageNode?.getAttribute?.('src') || imageNode?.getAttribute?.('data-src')),
        };
      })();

      // Merge with priority: bootstrap > jsonld > dom (bootstrap is freshest /
      // closest to the API; jsonld is well-typed; dom is last-resort).
      const merge = (a, b) => {
        if (!a) return b;
        if (!b) return a;
        const out = { ...a };
        for (const [k, v] of Object.entries(b)) {
          if (out[k] == null || out[k] === '') out[k] = v;
        }
        return out;
      };
      const merged = merge(merge(fromBootstrap, fromJsonLd), fromDom);
      const hasAnyField = merged && (merged.title || merged.price != null);
      if (!hasAnyField) {
        return { ok: false, reason: 'NO_DATA_EXTRACTED', currentProductId, loginHints };
      }

      return {
        ok: true,
        currentProductId,
        loginHints,
        data: merged,
      };
    })()
  `;
}

cli({
    site: 'coupang',
    name: 'product',
    access: 'read',
    description: 'Read full product detail (price, rating, seller, delivery) for a Coupang product',
    domain: 'www.coupang.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'product-id', positional: true, required: false, help: 'Coupang product ID (digits only)' },
        { name: 'url', required: false, help: 'Canonical Coupang product URL (alternative to --product-id)' },
    ],
    columns: [
        'product_id', 'title', 'price', 'original_price', 'discount_rate',
        'rating', 'review_count', 'seller', 'brand', 'rocket',
        'delivery_promise', 'image_url', 'url',
    ],
    func: async (page, kwargs) => {
        const rawProductId = kwargs['product-id'];
        if (!rawProductId && !kwargs.url) {
            throw new ArgumentError('Either --product-id or --url is required');
        }
        const productId = rawProductId
            ? requireProductIdArg(rawProductId, 'product-id')
            : requireProductIdArg(kwargs.url, '--url');
        const targetUrl = canonicalizeProductUrl(kwargs.url, productId);
        const finalUrl = targetUrl || canonicalizeProductUrl('', productId);
        await page.goto(finalUrl).catch((error) => {
            throw new CommandExecutionError(`coupang product navigation failed: ${error?.message || error}`);
        });
        await page.wait(2).catch((error) => {
            throw new CommandExecutionError(`coupang product wait failed: ${error?.message || error}`);
        });
        const result = await page.evaluate(buildProductDetailEvaluate(productId)).catch((error) => {
            throw new CommandExecutionError(`coupang product extraction failed: ${error?.message || error}`);
        });
        const loginHints = result?.loginHints ?? {};
        if (loginHints.hasLoginLink && !loginHints.hasMyCoupang) {
            throw new AuthRequiredError('coupang.com', 'Please log into Coupang in Chrome and retry.');
        }
        if (result?.reason === 'PRODUCT_MISMATCH') {
            const actualProductId = normalizeProductId(result?.currentProductId || '');
            const observed = actualProductId ? `got ${actualProductId}` : 'no product id observed';
            throw new EmptyResultError('coupang product', `Product page redirected: expected ${productId}, ${observed} (item may be sold out or unavailable in your region)`);
        }
        if (!result?.ok || !result?.data) {
            throw new EmptyResultError('coupang product', `No product data extracted from ${finalUrl}. The page may have failed to render or this product is restricted.`);
        }
        const actualProductId = normalizeProductId(result?.currentProductId || result.data.product_id || productId);
        const data = result.data;
        return [{
                product_id: actualProductId,
                title: data.title || null,
                price: data.price ?? null,
                original_price: data.original_price ?? null,
                discount_rate: data.discount_rate ?? null,
                rating: data.rating ?? null,
                review_count: data.review_count ?? null,
                seller: data.seller || null,
                brand: data.brand || null,
                rocket: data.rocket || null,
                delivery_promise: data.delivery_promise || null,
                image_url: data.image_url || null,
                url: canonicalizeProductUrl('', actualProductId) || finalUrl,
            }];
    },
});
