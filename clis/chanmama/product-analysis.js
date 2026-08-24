import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  EmptyResultError,
  capturedAt,
  cleanNumber,
  gotoDetail,
  integerInRange,
  metric,
  poll,
  requireId,
  shanghaiDate,
} from './_shared.js';

function ratioMap(items) {
  return Object.fromEntries((items || []).map((item) => [item.name || item.label, cleanNumber(item.value)]).filter(([name]) => name));
}

cli({
  site: 'chanmama',
  name: 'product-analysis',
  description: '读取商品基础分析、逐日成交、视频直播商品卡拆分及达人渠道结构',
  access: 'read',
  example: 'opencli chanmama product-analysis Oifq5_IBXNJaS6yWtMXo9U2tveAEURop --limit 30 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' },
    { name: 'limit', type: 'int', default: 30, help: '返回逐日记录数量，范围 1-30' },
  ],
  columns: ['date', 'promotionId', 'totalVolume', 'totalAmount', 'averagePrice', 'pageViews', 'conversionRatePct', 'relatedAuthors', 'videoVolume', 'liveVolume', 'cardVolume', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id);
    const limit = integerInRange(args.limit ?? 30, 'limit', 1, 30);
    const sourcePage = await gotoDetail(page, id);
    const payload = await poll(page, async () => page.evaluate(`async () => {
      let analysis = null; let tableVm = null; const pies = [];
      const seen = new Set();
      for (const element of document.querySelectorAll('*')) {
        let vm = element.__vue__;
        while (vm && !seen.has(vm)) {
          seen.add(vm);
          const name = vm.$options?.name;
          if (name === 'base-analysis') analysis = { overview: vm.overviewData, dateRange: vm.dateRange };
          if (name === 'base-table') tableVm = vm;
          if (name === 'pie-table') {
            const data = vm.basePieOptions?.series?.[0]?.data;
            if (Array.isArray(data) && data.length) pies.push(data.map((item) => ({ name: item.name, value: item.value })));
          }
          vm = vm.$parent;
        }
      }
      if (!tableVm) return { ready: false, reason: 'component' };
      const desired = { filter_coupon: false, page: 1, size: 30 };
      const signature = JSON.stringify(desired);
      if (tableVm.__opencliSignature !== signature) {
        tableVm.__opencliSignature = signature;
        Object.assign(tableVm.formData, desired);
        try { await tableVm.getData(); } catch (error) {
          return { ready: false, reason: error?.message || 'getData' };
        }
      }
      const loading = Boolean(tableVm.isLoading ?? tableVm.loading);
      const rows = Array.isArray(tableVm.dataList) ? tableVm.dataList.slice(0, ${limit}) : [];
      const delivery = pies.find((items) => items.some((item) => ['直播', '视频', '商品卡'].includes(item.name))) || [];
      const channel = pies.find((items) => items.some((item) => ['品牌自营号', '商家自营号', '达人号'].includes(item.name))) || [];
      return {
        ready: !loading && rows.length > 0 && analysis?.overview && Object.keys(analysis.overview).length > 0,
        analysis, rows, delivery, channel,
        totalCount: tableVm.totalCount ?? tableVm.pageInfo?.totalCount ?? null,
        reason: 'rows=' + rows.length + ' loading=' + String(loading)
      };
    }`), (value) => value?.ready, 24);
    if (!payload?.ready) throw new EmptyResultError('chanmama product-analysis', payload?.reason || `id=${id}`);

    const observedAt = capturedAt();
    const overview = payload.analysis?.overview || {};
    const overviewVolume = metric(overview, 'total_volume');
    const overviewAmount = metric(overview, 'total_amount');
    const deliveryVolumeSharePct = ratioMap(payload.delivery);
    const creatorChannelVolumeSharePct = ratioMap(payload.channel);
    return payload.rows.map((row) => {
      const total = metric(row, 'total_volume');
      const amount = metric(row, 'total_amount');
      const video = metric(row, 'aweme_volume');
      const live = metric(row, 'live_volume');
      const card = metric(row, 'other_volume');
      const conversionBand = row.conversion_rate_text || null;
      const conversionRatePct = String(conversionBand || '').includes('~') ? null : cleanNumber(row.conversion_rate);
      return {
        date: shanghaiDate(row.timestamp || row.time_node) || String(row.date || '').replaceAll('/', '-') || null,
        promotionId: id,
        totalVolume: total.value,
        totalAmount: amount.value,
        averagePrice: cleanNumber(row.final_avg_price),
        pageViews: cleanNumber(row.view_count),
        conversionRatePct,
        relatedAuthors: cleanNumber(row.related_author),
        videoVolume: video.value,
        liveVolume: live.value,
        cardVolume: card.value,
        detailsJson: JSON.stringify({
          conversionRateBand: conversionBand,
          deliveryVolumeSharePct,
          creatorChannelVolumeSharePct,
          dailyRelatedCounts: {
            videos: cleanNumber(row.related_aweme),
            lives: cleanNumber(row.related_live),
          },
          dailyAmounts: {
            video: metric(row, 'aweme_amount').value,
            live: metric(row, 'live_amount').value,
            card: metric(row, 'other_amount').value,
          },
          overview: {
            totalVolume: overviewVolume.value,
            totalAmount: overviewAmount.value,
            videoVolume: metric(overview, 'aweme_volume').value,
            videoAmount: metric(overview, 'aweme_amount').value,
            liveVolume: metric(overview, 'live_volume').value,
            liveAmount: metric(overview, 'live_amount').value,
            cardVolume: metric(overview, 'other_volume').value,
            cardAmount: metric(overview, 'other_amount').value,
            relatedAuthors: cleanNumber(overview.related_author),
            relatedVideos: cleanNumber(overview.related_aweme),
            videoAuthors: cleanNumber(overview.related_aweme_author),
            relatedLives: cleanNumber(overview.related_live),
            liveAuthors: cleanNumber(overview.related_live_author),
            pageViews: cleanNumber(overview.view_count),
            conversionRateBand: overview.conversion_rate_text || null,
            spuVolumeRatioPct: cleanNumber(overview.spu_volume_ratio),
          },
          valueTypes: {
            totalVolume: total.valueType, totalAmount: amount.valueType,
            videoVolume: video.valueType, liveVolume: live.valueType, cardVolume: card.valueType,
            overviewVolume: overviewVolume.valueType, overviewAmount: overviewAmount.valueType,
          },
          bands: {
            totalVolume: total.band, totalAmount: amount.band,
            videoVolume: video.band, liveVolume: live.band, cardVolume: card.band,
            overviewVolume: overviewVolume.band, overviewAmount: overviewAmount.band,
          },
          totalDays: payload.totalCount,
          windowStart: payload.analysis?.dateRange?.[0] || null,
          windowEnd: payload.analysis?.dateRange?.[1] || null,
          observedAt,
          sourcePlatform: 'chanmama',
          sourcePage,
          evidenceGrade: 'B-third-party-estimate',
        }),
      };
    });
  },
});
