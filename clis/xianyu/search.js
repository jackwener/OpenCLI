import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const ROWS_PER_PAGE = 30;
const MAX_LIMIT = 60;
function normalizeLimit(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 20;
    return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}
function buildSearchUrl(query) {
    return `https://www.goofish.com/search?q=${encodeURIComponent(query)}`;
}
// Parse a --min-price / --max-price argument into a non-negative number, or null when omitted.
// (`float` args are not auto-coerced by the framework, so they arrive as strings.)
function parsePriceArg(value, label) {
    if (value === undefined || value === null || value === '')
        return null;
    const n = Number(String(value).trim());
    if (!Number.isFinite(n) || n < 0) {
        throw new ArgumentError(`xianyu search ${label} must be a non-negative number`, `For example: --${label} 100000`);
    }
    return n;
}
// Goofish's PC search applies price filtering server-side via
// propValueStr.searchFilter = "priceRange:<min>,<max>;" (values in 元). An omitted
// bound is filled with a wide default so a single-sided range still works.
function buildSearchFilter(minPrice, maxPrice) {
    if (minPrice == null && maxPrice == null)
        return '';
    const lo = minPrice != null ? minPrice : 0;
    const hi = maxPrice != null ? maxPrice : 99999999;
    return `priceRange:${lo},${hi};`;
}
// Region filtering is server-side via extraFilterValue (a JSON string) carrying a
// divisionList of {province, city} pairs. A city alone (empty province) is accepted,
// as is a province alone (empty city). Returns "{}" when no region is requested.
function buildExtraFilterValue(province, city) {
    if (!province && !city)
        return '{}';
    return JSON.stringify({
        divisionList: [{ province: province || '', city: city || '' }],
        excludeMultiPlacesSellers: '0',
        extraDivision: '',
    });
}
function buildSearchEvaluate({ keyword, searchFilter, extraFilterValue, fromFilter, maxItems }) {
    return `
    (async () => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const cleanFirst = (...values) => values.map(clean).find(Boolean) || '';
      const cleanTagList = (value) => {
        const nodes = Array.isArray(value) ? value : [];
        return nodes
          .map((entry) => cleanFirst(entry?.text, entry?.title, entry?.name, entry?.label, entry?.content, entry?.data?.content))
          .filter(Boolean)
          .join(' | ');
      };
      const extractRetCode = (ret) => {
        const first = Array.isArray(ret) ? ret[0] : '';
        return clean(first).split('::')[0] || '';
      };
      const waitFor = async (predicate, timeoutMs = 6000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await new Promise((r) => setTimeout(r, 150));
        }
        return false;
      };

      const bodyText = document.body?.innerText || '';
      if (/请先登录|扫码登录|登录后/.test(bodyText)) return { error: 'auth-required' };
      if (/验证码|安全验证|异常访问/.test(bodyText)) return { error: 'blocked' };

      await waitFor(() => window.lib?.mtop?.request);
      if (!window.lib || !window.lib.mtop || typeof window.lib.mtop.request !== 'function') {
        return { error: 'mtop-not-ready' };
      }

      const searchFilter = ${JSON.stringify(searchFilter)};
      const propValueStr = searchFilter ? { searchFilter } : {};
      const rows = ${ROWS_PER_PAGE};
      const maxItems = ${maxItems};
      const maxPages = Math.ceil(maxItems / rows);
      const collected = [];

      for (let page = 1; page <= maxPages && collected.length < maxItems; page++) {
        let response;
        try {
          response = await window.lib.mtop.request({
            api: 'mtop.taobao.idlemtopsearch.pc.search',
            data: {
              pageNumber: page,
              keyword: ${JSON.stringify(keyword)},
              fromFilter: ${fromFilter ? 'true' : 'false'},
              rowsPerPage: rows,
              sortValue: '',
              sortField: '',
              customDistance: '',
              gps: '',
              propValueStr,
              customGps: '',
              searchReqFromPage: 'pcSearch',
              extraFilterValue: ${JSON.stringify(extraFilterValue)},
              userPositionJson: '{}',
            },
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

        if (!response?.data || !Array.isArray(response.data.resultList)) {
          return {
            error: 'malformed-response',
            error_message: 'Xianyu search response did not include a resultList array',
          };
        }

        const list = response.data.resultList;
        if (!list.length) break;

        let pageValidRows = 0;
        let pageMalformedRows = 0;
        for (const entry of list) {
          const itemNode = entry?.data?.item || {};
          const main = itemNode.main || {};
          const args = main.clickParam?.args || {};
          const ex = main.exContent || itemNode.exContent || {};
          const itemId = clean(args.item_id || args.id || '');
          const title = clean(ex.title || ex.detailParams?.title || '');
          if (!itemId || !title) {
            pageMalformedRows += 1;
            continue;
          }
          const priceYuan = clean(args.price || args.displayPrice || '');
          const city = clean(args.p_city || '');
          const area = clean(ex.area || '');
          const tagText = cleanTagList(ex.fishTags || ex.labels || ex.tags || ex.tagList || []);
          collected.push({
            item_id: itemId,
            title,
            price: priceYuan ? ('¥' + priceYuan) : '',
            condition: cleanFirst(ex.condition, ex.stuffStatus, ex.detailParams?.condition),
            brand: cleanFirst(ex.brand, ex.brandName, ex.detailParams?.brand),
            location: city || area,
            badge: cleanFirst(ex.badge, ex.creditText, ex.creditLevel, tagText),
            want: clean(args.wantNum || ex.want || ''),
            url: 'https://www.goofish.com/item?id=' + itemId,
          });
          pageValidRows += 1;
          if (collected.length >= maxItems) break;
        }

        if (!pageValidRows && pageMalformedRows) {
          return {
            error: 'malformed-row',
            error_message: 'Xianyu search result rows were missing item_id or title',
          };
        }

        if (list.length < rows) break;
      }

      return { items: collected };
    })()
  `;
}
cli({
    site: 'xianyu',
    name: 'search',
    access: 'read',
    description: '搜索闲鱼商品（支持服务端价格区间 / 地区筛选）',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 20, help: `返回结果数（最多 ${MAX_LIMIT}，自动翻页）` },
        { name: 'min-price', type: 'float', help: '最低价格（元），服务端筛选' },
        { name: 'max-price', type: 'float', help: '最高价格（元），服务端筛选' },
        { name: 'province', type: 'string', help: '省份名（如 广东），服务端按地区筛选' },
        { name: 'city', type: 'string', help: '城市名（如 深圳 / 湛江），可单独使用，服务端按地区筛选' },
    ],
    columns: ['item_id', 'rank', 'title', 'price', 'condition', 'brand', 'location', 'badge', 'want', 'url'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query || '').trim();
        const limit = normalizeLimit(kwargs.limit);
        const minPrice = parsePriceArg(kwargs['min-price'], 'min-price');
        const maxPrice = parsePriceArg(kwargs['max-price'], 'max-price');
        if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
            throw new ArgumentError('xianyu search min-price cannot be greater than max-price', `Received --min-price ${minPrice} and --max-price ${maxPrice}`);
        }
        const province = String(kwargs.province || '').trim();
        const city = String(kwargs.city || '').trim();
        const searchFilter = buildSearchFilter(minPrice, maxPrice);
        const extraFilterValue = buildExtraFilterValue(province, city);
        const fromFilter = Boolean(searchFilter) || extraFilterValue !== '{}';
        await page.goto(buildSearchUrl(query));
        await page.wait(2);
        const result = await page.evaluate(buildSearchEvaluate({ keyword: query, searchFilter, extraFilterValue, fromFilter, maxItems: limit }));
        if (result?.error === 'auth-required') {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu search requires a logged-in browser session');
        }
        if (result?.error === 'blocked') {
            throw new CommandExecutionError('Xianyu returned a verification page or blocked the current browser session');
        }
        if (result?.error === 'mtop-not-ready') {
            throw selectorError('window.lib.mtop', '闲鱼页面未完成初始化，无法调用搜索接口');
        }
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Xianyu search returned a malformed response');
        }
        const errorCode = String(result?.error_code || '');
        const errorMessage = String(result?.error_message || '');
        if (/FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED|FAIL_SYS_TOKEN/.test(errorCode) || /FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED/.test(errorMessage)) {
            throw new AuthRequiredError('www.goofish.com', 'Xianyu search requires a logged-in browser session');
        }
        if (result?.error) {
            throw new CommandExecutionError(errorMessage || `Xianyu search request failed: ${result.error}`);
        }
        if (!Array.isArray(result.items)) {
            throw new CommandExecutionError('Xianyu search response did not include an items array');
        }
        const items = result.items;
        if (!items.length) {
            throw new EmptyResultError('xianyu search', '没有匹配的商品（筛选条件可能过窄，或当前关键词无结果）');
        }
        return items.map((item, index) => ({ rank: index + 1, ...item }));
    },
});
export const __test__ = {
    ROWS_PER_PAGE,
    MAX_LIMIT,
    normalizeLimit,
    buildSearchUrl,
    parsePriceArg,
    buildSearchFilter,
    buildExtraFilterValue,
};
