import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { canonicalizeProductUrl, normalizeProductId, requireProductIdArg } from './utils.js';
function escapeJsString(value) {
    return JSON.stringify(value);
}
function buildAddToCartEvaluate(expectedProductId) {
    return `
    (async () => {
      const expectedProductId = ${escapeJsString(expectedProductId)};
      const text = document.body.innerText || '';
      const loginHints = {
        hasLoginLink: Boolean(document.querySelector('a[href*="login"], a[title*="로그인"]')),
        hasMyCoupang: /마이쿠팡/.test(text),
      };

      const pathMatch = location.pathname.match(/\\/vp\\/products\\/(\\d+)/);
      const currentProductId = pathMatch?.[1] || '';
      if (expectedProductId && currentProductId && expectedProductId !== currentProductId) {
        return { ok: false, reason: 'PRODUCT_MISMATCH', currentProductId, loginHints };
      }

      const optionSelectors = [
        'select',
        '[role="listbox"]',
        '.prod-option, .product-option, .option-select, .option-dropdown',
      ];
      const hasRequiredOption = optionSelectors.some((selector) => {
        try {
          const nodes = Array.from(document.querySelectorAll(selector));
          return nodes.some((node) => {
            const label = (node.textContent || '') + ' ' + (node.getAttribute?.('aria-label') || '');
            return /옵션|색상|사이즈|용량|선택/i.test(label);
          });
        } catch {
          return false;
        }
      });
      if (hasRequiredOption) {
        return { ok: false, reason: 'OPTION_REQUIRED', currentProductId, loginHints };
      }

      const clickCandidate = (elements) => {
        for (const element of elements) {
          if (!(element instanceof HTMLElement)) continue;
          const label = ((element.innerText || '') + ' ' + (element.getAttribute('aria-label') || '')).trim();
          if (/장바구니|카트|cart/i.test(label) && !/sold out|품절/i.test(label)) {
            element.click();
            return true;
          }
        }
        return false;
      };

      const beforeCount = (() => {
        const node = document.querySelector('[class*="cart"] .count, #headerCartCount, .cart-count');
        const text = node?.textContent || '';
        const num = Number(text.replace(/[^\\d]/g, ''));
        return Number.isFinite(num) ? num : null;
      })();

      const buttons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"]'));
      const clicked = clickCandidate(buttons);
      if (!clicked) {
        return { ok: false, reason: 'ADD_TO_CART_BUTTON_NOT_FOUND', currentProductId, loginHints };
      }

      await new Promise((resolve) => setTimeout(resolve, 2500));

      const afterText = document.body.innerText || '';
      const successMessage = /장바구니에 담|장바구니 담기 완료|added to cart/i.test(afterText);
      const afterCount = (() => {
        const node = document.querySelector('[class*="cart"] .count, #headerCartCount, .cart-count');
        const text = node?.textContent || '';
        const num = Number(text.replace(/[^\\d]/g, ''));
        return Number.isFinite(num) ? num : null;
      })();
      const countIncreased =
        beforeCount != null &&
        afterCount != null &&
        afterCount >= beforeCount &&
        (afterCount > beforeCount || beforeCount === 0);

      return {
        ok: successMessage || countIncreased,
        reason: successMessage || countIncreased ? 'SUCCESS' : 'UNKNOWN',
        currentProductId,
        beforeCount,
        afterCount,
        loginHints,
      };
    })()
  `;
}
cli({
    site: 'coupang',
    name: 'add-to-cart',
    access: 'write',
    description: 'Add a Coupang product to cart using logged-in browser session',
    domain: 'www.coupang.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'product-id', positional: true, required: false, help: 'Coupang product ID' },
        { name: 'url', required: false, help: 'Canonical product URL' },
    ],
    columns: ['ok', 'product_id', 'url', 'message'],
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
            throw new CommandExecutionError(`coupang add-to-cart navigation failed: ${error?.message || error}`);
        });
        const result = await page.evaluate(buildAddToCartEvaluate(productId)).catch((error) => {
            throw new CommandExecutionError(`coupang add-to-cart evaluation failed: ${error?.message || error}`);
        });
        const loginHints = result?.loginHints ?? {};
        if (loginHints.hasLoginLink && !loginHints.hasMyCoupang) {
            throw new AuthRequiredError('coupang.com', 'Please log into Coupang in Chrome and retry.');
        }
        const actualProductId = normalizeProductId(result?.currentProductId || productId);
        if (result?.reason === 'PRODUCT_MISMATCH') {
            const observed = actualProductId ? `got ${actualProductId}` : 'no product id observed';
            throw new CommandExecutionError(`Product mismatch: expected ${productId}, ${observed}`);
        }
        if (result?.reason === 'OPTION_REQUIRED') {
            throw new CommandExecutionError('This product requires option selection and is not supported in v1.');
        }
        if (result?.reason === 'ADD_TO_CART_BUTTON_NOT_FOUND') {
            throw new CommandExecutionError('Could not find an add-to-cart button on the product page.');
        }
        if (!result?.ok) {
            throw new CommandExecutionError('Failed to confirm add-to-cart success.');
        }
        return [{
                ok: true,
                product_id: actualProductId || productId,
                url: finalUrl,
                message: 'Added to cart',
            }];
    },
});
