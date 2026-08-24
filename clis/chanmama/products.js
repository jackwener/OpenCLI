import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  BASE_URL,
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
  assertChanMamaPage,
  capturedAt,
  categoryLevels,
  categoryPath,
  cleanNumber,
  integerInRange,
  isoTime,
  metric,
  poll,
} from './_shared.js';

const SORTS = new Set([
  'duration_volume', 'duration_amount', 'duration_aweme_volume', 'duration_aweme_amount',
  'duration_live_volume', 'duration_live_amount', 'duration_other_volume', 'duration_other_amount',
  'duration_author_count', 'duration_aweme_count', 'duration_live_count', 'duration_pv',
  'duration_product_rate', 'day30_volume_trend',
]);

const COMMISSION_RANGES = new Set([
  '', '0-5', '5-10', '10-20', '20-30', '30-40', '40-50', '50-60', '60-',
]);

const MIN_SALES_VALUES = new Set([0, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000]);

cli({
  site: 'chanmama',
  name: 'products',
  description: '读取蝉妈妈商品榜，拆分视频/直播/商品卡成交并保留估算口径',
  access: 'read',
  example: 'opencli chanmama products --category 14 --days 30 --sort duration_volume --limit 20 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'category', type: 'string', default: '', help: '蝉妈妈类目ID；先用categories查询' },
    { name: 'query', type: 'string', default: '', help: '商品标题关键词' },
    { name: 'days', type: 'int', default: 30, help: '榜单周期：1、7或30天' },
    {
      name: 'sort',
      type: 'string',
      default: 'duration_volume',
      help: '排序：duration_volume / duration_amount / duration_aweme_volume / duration_aweme_amount / duration_live_volume / duration_live_amount / duration_other_volume / duration_other_amount / duration_author_count / duration_aweme_count / duration_live_count / duration_pv / duration_product_rate / day30_volume_trend',
    },
    { name: 'order', type: 'string', default: 'desc', help: 'desc或asc' },
    { name: 'has-commission', type: 'boolean', default: false, help: '只看有公开佣金商品' },
    { name: 'commission-range', type: 'string', default: '', help: '公开佣金档位：0-5、5-10、10-20、20-30、30-40、40-50、50-60或60-' },
    { name: 'has-high-commission', type: 'boolean', default: false, help: '只看有蝉妈妈高佣商品' },
    { name: 'min-video-share-pct', type: 'int', default: 0, help: '视频带货销量占比下限，0关闭；页面默认主导阈值为51' },
    { name: 'min-sales', type: 'int', default: 0, help: '周期销量下限：0、100、200、300、500、1000、2000、3000、5000或10000' },
    { name: 'new-product', type: 'boolean', default: false, help: '只看新上架商品' },
    { name: 'page', type: 'int', default: 1, help: '页码，从 1 开始；每页最多 50 条' },
    { name: 'limit', type: 'int', default: 20, help: '返回商品数量，范围 1-50' },
  ],
  columns: [
    'rank', 'promotionId', 'title', 'categoryPath', 'leafCategoryId', 'commissionPct',
    'totalVolume', 'videoVolume', 'videoAmount', 'relatedAuthorCount', 'relatedVideoCount', 'detailsJson',
  ],
  func: async (page, args) => {
    const category = String(args.category || '').trim();
    const query = String(args.query || '').trim();
    const days = Number(args.days ?? 30);
    const sort = String(args.sort || 'duration_volume').trim();
    const order = String(args.order || 'desc').trim().toLowerCase();
    const commissionRange = String(args['commission-range'] || '').trim();
    const hasCommission = args['has-commission'] === true || commissionRange !== '';
    const hasHighCommission = args['has-high-commission'] === true;
    const minVideoSharePct = integerInRange(args['min-video-share-pct'] ?? 0, 'min-video-share-pct', 0, 100);
    const minSales = Number(args['min-sales'] ?? 0);
    const newProduct = args['new-product'] === true;
    const pageNumber = integerInRange(args.page ?? 1, 'page', 1, 1000);
    const limit = integerInRange(args.limit ?? 20, 'limit', 1, 50);
    if (category && !/^\d+$/.test(category)) throw new ArgumentError('category must be a numeric category id');
    if (![1, 7, 30].includes(days)) throw new ArgumentError('days must be one of 1, 7, 30');
    if (!SORTS.has(sort)) throw new ArgumentError(`unsupported sort: ${sort}`);
    if (!['asc', 'desc'].includes(order)) throw new ArgumentError('order must be asc or desc');
    if (!COMMISSION_RANGES.has(commissionRange)) {
      throw new ArgumentError('commission-range must be one of 0-5, 5-10, 10-20, 20-30, 30-40, 40-50, 50-60, 60-');
    }
    if (!Number.isInteger(minSales) || !MIN_SALES_VALUES.has(minSales)) {
      throw new ArgumentError('min-sales must be one of 0, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000');
    }

    const url = `${BASE_URL}/promotionRank/${category ? `?multi_category_id=${encodeURIComponent(category)}` : ''}`;
    await page.goto(url);
    await page.wait(3);
    await assertChanMamaPage(page);

    const payload = await poll(page, async () => page.evaluate(`async () => {
      let vm = null;
      const visibleRow = document.querySelector('table tbody tr');
      let rowVm = visibleRow?.__vue__;
      while (rowVm && rowVm.$options?.name !== 'product-search') rowVm = rowVm.$parent;
      if (rowVm) vm = rowVm;
      const seen = new Set();
      for (const element of vm ? [] : document.querySelectorAll('*')) {
        let candidate = element.__vue__;
        while (candidate && !seen.has(candidate)) {
          seen.add(candidate);
          if (candidate.$options?.name === 'product-search') { vm = candidate; break; }
          candidate = candidate.$parent;
        }
        if (vm) break;
      }
      if (!vm) return { ready: false, reason: 'component' };
      const desired = {
        bring_author_id: '',
        bring_author_nickname: '',
        bring_brand_code: '',
        bring_brand_name: '',
        day_type: ${days},
        multi_category_id: ${JSON.stringify(category)},
        keyword: ${JSON.stringify(query)},
        sort: ${JSON.stringify(sort)},
        order_by: ${JSON.stringify(order)},
        has_commission: ${hasCommission ? 1 : 0},
        mulit_commission_rate: ${JSON.stringify(commissionRange)},
        has_jx_commission: ${hasHighCommission ? 1 : 0},
        most_aweme_volume: ${minVideoSharePct},
        most_live_volume: 0,
        most_other_volume: 0,
        most_volume: ${minVideoSharePct > 0 ? 1 : 0},
        duration_volume: ${JSON.stringify(minSales > 0 ? `${minSales}-` : '')},
        duration_author_count: '',
        duration_pv_count: '',
        price: '',
        expr_score: '',
        good_comment_rate: '',
        is_price_40_plus: 0,
        is_new_product: ${newProduct ? 1 : 0},
        is_free_mail: 0,
        is_low_price: 0,
        global_purchase: 0,
        has_coupon: 0,
        channel: -1,
        fans_age: '',
        fans_gender: 0,
        fans_province: '',
        order_age: '',
        order_city: [''],
        order_gender: 0,
        services_labels: [''],
        shipments_province: '',
        industry_color: '',
        industry_craft: '',
        industry_efficacy: '',
        industry_fabric: '',
        industry_function: '',
        industry_ingredients: '',
        industry_kind: '',
        industry_new_time: '',
        industry_packaging: '',
        industry_pattern: '',
        industry_people: '',
        industry_place_origin: '',
        industry_scene: '',
        industry_selling: '',
        industry_spec: '',
        industry_style: '',
        industry_taste: '',
        page: ${pageNumber},
        size: 50,
        cal_day30_volume_trend: 1
      };
      if (!vm.formData || !vm.searchData || typeof vm.getData !== 'function') {
        return { ready: false, reason: 'component-state-not-ready' };
      }
      const signature = JSON.stringify(desired);
      if (vm.__opencliSignature !== signature) {
        vm.__opencliSignature = signature;
        vm.dayType = desired.day_type;
        vm.multi_category_id = desired.multi_category_id;
        vm.keyword = desired.keyword;
        vm.page = desired.page;
        Object.assign(vm.formData, desired);
        Object.assign(vm.searchData, desired);
        try { await vm.getData(); } catch (error) { return { ready: false, reason: error?.message || 'getData' }; }
      }
      return {
        ready: !vm.isLoading && Array.isArray(vm.dataList) && vm.dataList.length > 0,
        rows: Array.isArray(vm.dataList) ? vm.dataList.slice(0, ${limit}) : [],
        totalCount: vm.pageInfo?.totalCount ?? null,
        actualDays: vm.dayType,
        actualCategory: vm.formData?.multi_category_id ?? vm.multi_category_id ?? null,
        actualPage: vm.formData?.page ?? vm.searchData?.page ?? vm.page ?? null,
        actualFilters: {
          hasCommission: vm.formData?.has_commission ?? null,
          commissionRange: vm.formData?.mulit_commission_rate ?? null,
          hasHighCommission: vm.formData?.has_jx_commission ?? null,
          minVideoSharePct: vm.formData?.most_aweme_volume ?? null,
          mostVolume: vm.formData?.most_volume ?? null,
          minSales: vm.formData?.duration_volume ?? null,
          newProduct: vm.formData?.is_new_product ?? null
        },
        reason: 'state rows=' + (Array.isArray(vm.dataList) ? vm.dataList.length : 'not-array') + ' loading=' + String(vm.isLoading)
      };
    }`), (value) => value?.ready, 16);

    if (!payload?.ready) throw new EmptyResultError('chanmama products', payload?.reason || `category=${category}, query=${query}`);
    if (category && String(payload.actualCategory) !== category) {
      throw new CommandExecutionError(`category state mismatch: expected=${category}, actual=${payload.actualCategory}`);
    }
    if (Number(payload.actualDays) !== days) {
      throw new CommandExecutionError(`day window mismatch: expected=${days}, actual=${payload.actualDays}`);
    }
    if (Number(payload.actualPage) !== pageNumber) {
      throw new CommandExecutionError(`page state mismatch: expected=${pageNumber}, actual=${payload.actualPage}`);
    }
    const expectedFilters = {
      hasCommission: hasCommission ? 1 : 0,
      commissionRange,
      hasHighCommission: hasHighCommission ? 1 : 0,
      minVideoSharePct,
      mostVolume: minVideoSharePct > 0 ? 1 : 0,
      minSales: minSales > 0 ? `${minSales}-` : '',
      newProduct: newProduct ? 1 : 0,
    };
    for (const [key, expected] of Object.entries(expectedFilters)) {
      const actual = payload.actualFilters?.[key];
      if (String(actual ?? '') !== String(expected)) {
        throw new CommandExecutionError(`filter state mismatch for ${key}: expected=${expected}, actual=${actual}`);
      }
    }

    const observedAt = capturedAt();
    return payload.rows.map((row, index) => {
      const total = metric(row, 'duration_volume');
      const video = metric(row, 'duration_aweme_volume');
      const videoAmount = metric(row, 'duration_aweme_amount');
      const live = metric(row, 'duration_live_volume');
      const card = metric(row, 'duration_other_volume');
      const amount = metric(row, 'duration_amount');
      const relatedAuthorCount = cleanNumber(row.duration_author_count);
      const relatedVideoCount = cleanNumber(row.duration_video_count ?? row.duration_aweme_count);
      const levels = categoryLevels(row.v11_category);
      const deliverySharePctEstimate = total.value && total.value > 0 ? {
        video: video.value === null ? null : Number(((video.value / total.value) * 100).toFixed(2)),
        live: live.value === null ? null : Number(((live.value / total.value) * 100).toFixed(2)),
        card: card.value === null ? null : Number(((card.value / total.value) * 100).toFixed(2)),
      } : { video: null, live: null, card: null };
      return {
        rank: ((pageNumber - 1) * 50) + index + 1,
        promotionId: row.promotion_id,
        title: row.title,
        categoryPath: categoryPath(row.v11_category),
        leafCategoryId: levels.leafId,
        commissionPct: cleanNumber(row.tb_max_commission_rate),
        totalVolume: total.value,
        videoVolume: video.value,
        videoAmount: videoAmount.value,
        relatedAuthorCount,
        relatedVideoCount,
        detailsJson: JSON.stringify({
          brand: row.brand || null,
          shopName: row.shop_name || null,
          liveVolume: live.value,
          cardVolume: card.value,
          leafCategoryName: levels.leafName,
          categoryLevels: levels.levels,
          relatedAuthorCount,
          relatedVideoCount,
          detailUrl: `${BASE_URL}/promotionDetail/${row.promotion_id}`,
          category: levels,
          highCommissionPct: cleanNumber(row.jx_commission_rate),
          totalAmount: amount.value,
          relatedLiveCount: cleanNumber(row.duration_live_count),
          conversionRatePct: cleanNumber(row.conversion_rate),
          conversionRateBand: row.duration_product_rate_text || null,
          shopExperienceScore: cleanNumber(row.shop_expr_score),
          goodCommentRate: cleanNumber(row.good_comment_rate),
          firstListedAt: isoTime(row.first_listed_time),
          shelfStatusCode: row.is_shelf ?? null,
          valueTypes: { total: total.valueType, video: video.valueType, videoAmount: videoAmount.valueType, live: live.valueType, card: card.valueType, amount: amount.valueType },
          bands: { total: total.band, video: video.band, videoAmount: videoAmount.band, live: live.band, card: card.band, amount: amount.band },
          day30Trend: Array.isArray(row.day30_volume_trend) ? row.day30_volume_trend : [],
          periodDays: days,
          observedAt,
          sourcePlatform: 'chanmama',
          sourcePage: url,
          evidenceGrade: 'B-third-party-estimate',
          cohortSampleTotal: payload.totalCount,
          appliedFilters: expectedFilters,
          discoveryContext: { query, sort, order, page: pageNumber, pageSize: 50 },
          deliverySharePctEstimate,
        }),
      };
    });
  },
});
