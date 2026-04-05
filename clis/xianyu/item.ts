import { AuthRequiredError, EmptyResultError, SelectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from './utils.js';

function buildItemUrl(itemId: string): string {
  return `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}`;
}

function buildFetchItemEvaluate(itemId: string): string {
  return `
    (async () => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const extractRetCode = (ret) => {
        const first = Array.isArray(ret) ? ret[0] : '';
        return clean(first).split('::')[0] || '';
      };

      const waitFor = async (predicate, timeoutMs = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await new Promise((r) => setTimeout(r, 150));
        }
        return false;
      };

      const bodyText = document.body?.innerText || '';
      if (/请先登录|登录后/.test(bodyText)) {
        return { error: 'auth-required' };
      }

      if (/验证码|安全验证|异常访问/.test(bodyText)) {
        return { error: 'blocked' };
      }

      await waitFor(() => window.lib?.mtop?.request);
      if (!window.lib || !window.lib.mtop || typeof window.lib.mtop.request !== 'function') {
        return { error: 'mtop-not-ready' };
      }

      let response;
      try {
        response = await window.lib.mtop.request({
          api: 'mtop.taobao.idle.pc.detail',
          data: { itemId: ${JSON.stringify(itemId)} },
          type: 'POST',
          v: '1.0',
          dataType: 'json',
          needLogin: false,
          needLoginPC: false,
          sessionOption: 'AutoLoginOnly',
          ecode: 0,
        });
      } catch (error) {
        const ret = error?.ret || [];
        return {
          error: 'mtop-request-failed',
          error_code: extractRetCode(ret),
          error_message: clean(Array.isArray(ret) ? ret.join(' | ') : error?.message || error),
        };
      }

      const retCode = extractRetCode(response?.ret || []);
      if (retCode && retCode !== 'SUCCESS') {
        return {
          error: 'mtop-response-error',
          error_code: retCode,
          error_message: clean((response?.ret || []).join(' | ')),
        };
      }

      const data = response?.data || {};
      const item = data.itemDO || {};
      const seller = data.sellerDO || {};
      const labels = Array.isArray(item.itemLabelExtList) ? item.itemLabelExtList : [];
      const findLabel = (name) => labels.find((label) => clean(label.propertyText) === name)?.text || '';
      const images = Array.isArray(item.imageInfos)
        ? item.imageInfos.map((entry) => entry?.url).filter(Boolean)
        : [];

      return {
        item_id: clean(item.itemId || ${JSON.stringify(itemId)}),
        title: clean(item.title || ''),
        description: clean(item.desc || ''),
        price: clean('¥' + (item.soldPrice || item.defaultPrice || '')).replace(/^¥\\s*$/, ''),
        original_price: clean(item.originalPrice || ''),
        want_count: String(item.wantCnt ?? ''),
        collect_count: String(item.collectCnt ?? ''),
        browse_count: String(item.browseCnt ?? ''),
        status: clean(item.itemStatusStr || ''),
        condition: clean(findLabel('成色')),
        brand: clean(findLabel('品牌')),
        category: clean(findLabel('分类')),
        location: clean(seller.publishCity || seller.city || ''),
        seller_name: clean(seller.nick || seller.uniqueName || ''),
        seller_id: String(seller.sellerId || ''),
        seller_score: clean(seller.xianyuSummary || ''),
        reply_ratio_24h: clean(seller.replyRatio24h || ''),
        reply_interval: clean(seller.replyInterval || ''),
        item_url: ${JSON.stringify(buildItemUrl(itemId))},
        seller_url: seller.sellerId ? 'https://www.goofish.com/personal?userId=' + seller.sellerId : '',
        image_count: String(images.length),
        image_urls: images,
      };
    })()
  `;
}

cli({
  site: 'xianyu',
  name: 'item',
  description: '查看闲鱼商品详情',
  domain: 'www.goofish.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'item_id', required: true, positional: true, help: '闲鱼商品 item_id' },
  ],
  columns: ['item_id', 'title', 'price', 'condition', 'brand', 'location', 'seller_name', 'want_count'],
  func: async (page, kwargs) => {
    const itemId = normalizeNumericId(kwargs.item_id, 'item_id', '1040754408976');

    await page.goto(buildItemUrl(itemId));
    await page.wait(2);

    const result = await page.evaluate(buildFetchItemEvaluate(itemId)) as {
      error?: string;
      error_code?: string;
      error_message?: string;
      title?: string;
      item_id?: string;
    } & Record<string, unknown>;

    if (result?.error === 'auth-required') {
      throw new AuthRequiredError('www.goofish.com', 'Xianyu item detail requires a logged-in browser session');
    }

    if (result?.error === 'blocked') {
      throw new EmptyResultError('xianyu item', 'Xianyu item detail is blocked by verification or risk control');
    }

    if (result?.error === 'mtop-not-ready') {
      throw new SelectorError('window.lib.mtop', '闲鱼页面未完成初始化，无法调用商品详情接口');
    }

    if (!result || typeof result !== 'object') {
      throw new EmptyResultError('xianyu item', '闲鱼商品详情接口未返回有效数据');
    }

    const errorCode = String(result.error_code || '');
    const errorMessage = String(result.error_message || '');
    if (/FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED|FAIL_SYS/.test(errorCode) || /FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED/.test(errorMessage)) {
      throw new AuthRequiredError('www.goofish.com', 'Xianyu item detail requires a logged-in browser session');
    }

    if (result.error) {
      throw new EmptyResultError('xianyu item', errorMessage || `Xianyu item detail request failed: ${result.error}`);
    }

    if (!String(result.title || '').trim()) {
      throw new EmptyResultError('xianyu item', 'No item detail was returned for the specified item_id');
    }

    return [result];
  },
});

export const __test__ = {
  normalizeNumericId,
  buildItemUrl,
};
