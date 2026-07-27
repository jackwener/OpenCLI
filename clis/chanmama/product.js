import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  BASE_URL,
  CommandExecutionError,
  EmptyResultError,
  capturedAt,
  categoryLevels,
  categoryPath,
  cleanNumber,
  gotoDetail,
  isoTime,
  metric,
  poll,
  requireId,
} from './_shared.js';

cli({
  site: 'chanmama',
  name: 'product',
  description: '读取蝉妈妈商品详情、价格遮罩、佣金、店铺、服务和近30天概览',
  access: 'read',
  example: 'opencli chanmama product Oifq5_IBXNJaS6yWtMXo9U2tveAEURop -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [{ name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' }],
  columns: [
    'promotionId', 'title', 'categoryPath', 'leafCategoryId', 'brand', 'shopName',
    'publicCommissionPct', 'price', 'day30Volume', 'historyVolume', 'productUrl', 'detailsJson',
  ],
  func: async (page, args) => {
    const id = requireId(args.id);
    const detailUrl = await gotoDetail(page, id);
    const snapshot = await poll(page, async () => page.evaluate(`() => {
      const seen = new Set();
      for (const element of document.querySelectorAll('*')) {
        const vm = element.__vue__;
        if (!vm || seen.has(vm)) continue;
        seen.add(vm);
        if (vm.$options?.name === 'product-detail' && vm.productInfo?.product) {
          return { product: vm.productInfo.product, fresh: vm.productInfo.new, jx: vm.productInfo.jxData, rankData: vm.rankData };
        }
      }
      return null;
    }`), (value) => Boolean(value?.product), 12);
    if (!snapshot?.product) throw new EmptyResultError('chanmama product', `id=${id}`);
    const product = snapshot.product;
    if (String(product.promotion_id) !== id) throw new CommandExecutionError(`product id mismatch: expected=${id}, actual=${product.promotion_id}`);

    const day30 = metric(product, 'day30_volume');
    const history = metric(product, 'history_total_volume');
    const priceText = product.trade_price_text || product.sku_union_price_text || null;
    const price = ['**', '-', ''].includes(String(priceText || ''))
      ? null
      : cleanNumber(product.final_price || product.trade_price || product.price);
    const levels = categoryLevels(product.v11_category);
    return [{
      promotionId: product.promotion_id,
      title: product.title,
      categoryPath: categoryPath(product.v11_category),
      leafCategoryId: levels.leafId,
      brand: product.brand_name || null,
      shopName: product.shop_name || null,
      publicCommissionPct: cleanNumber(product.tb_max_commission_rate),
      price,
      day30Volume: day30.value,
      historyVolume: history.value,
      productUrl: product.product_short_url || product.short_url || product.url || null,
      detailsJson: JSON.stringify({
        highCommissionPct: cleanNumber(snapshot.jx?.jx_cos_ratio),
        firstListedAt: isoTime(snapshot.fresh?.first_available || product.first_available || product.final_volume_first_crawl_time),
        shelfStatusCode: product.is_shelf ?? null,
        detailUrl,
        spuId: product.spu_id || null,
        spuTitle: product.spu_title || null,
        spuProductCount: cleanNumber(product.spu_product_num),
        category: levels,
        officialCategoryPath: product.dy_official_category_text || null,
        priceText,
        estimatedCommission: cleanNumber(product.estimated_commission),
        shopId: product.shop_id || null,
        shopExperienceScore: cleanNumber(product.shop_expr_score),
        goodRating: cleanNumber(snapshot.fresh?.good_rating ?? product.good_ratio),
        services: snapshot.fresh?.services_label_array || product.services_label_array || [],
        shippingPlace: snapshot.fresh?.shipping_place || product.shipments || null,
        couponLabels: product.coupon_array || [],
        productPageViews: cleanNumber(product.pv_count),
        day30ConversionRateRatio: cleanNumber(product.day30_product_rate_v2),
        ranks: snapshot.rankData || [],
        valueTypes: { price: price === null ? 'masked' : 'exact', day30Volume: day30.valueType, historyVolume: history.valueType },
        bands: { day30Volume: day30.band, historyVolume: history.band },
        observedAt: capturedAt(),
        sourcePlatform: 'chanmama',
        sourcePage: detailUrl,
        evidenceGrade: 'B-third-party-estimate',
      }),
    }];
  },
});
