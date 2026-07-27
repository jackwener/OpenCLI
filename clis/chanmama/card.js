import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, capturedAt, gotoDetail, integerInRange, metric, poll, requireId, shanghaiDate } from './_shared.js';

cli({
  site: 'chanmama', name: 'card', description: '读取商品近30天商品卡成交日趋势及概览', access: 'read',
  example: 'opencli chanmama card Oifq5_IBXNJaS6yWtMXo9U2tveAEURop --limit 30 -f json',
  domain: 'chanmama.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
  siteSession: 'persistent', defaultWindowMode: 'background',
  args: [{ name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' }, { name: 'limit', type: 'int', default: 30, help: '返回天数，范围 1-30' }],
  columns: ['date', 'promotionId', 'productVolume', 'productAmount', 'volumeValueType', 'amountValueType', 'windowStart', 'windowEnd', 'observedAt', 'sourcePage', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id); const limit = integerInRange(args.limit ?? 30, 'limit', 1, 30);
    const sourcePage = await gotoDetail(page, id, 'card');
    const payload = await poll(page, async () => page.evaluate(`() => {
      const seen = new Set(); let overview = null; let trend = null;
      for (const element of document.querySelectorAll('*')) {
        const vm = element.__vue__; if (!vm || seen.has(vm)) continue; seen.add(vm);
        if (vm.$options?.name === 'card-analysis') overview = { data: vm.overviewData, dateRange: vm.dateRange };
        if (vm.$options?.name === 'card-trend') trend = { rows: vm.dataList?.slice(0, ${limit}) || [], loading: vm.isLoading };
      }
      return { overview, trend };
    }`), (value) => value?.trend?.rows?.length > 0 && !value.trend.loading && Object.keys(value?.overview?.data || {}).length > 0, 18);
    if (!payload?.trend?.rows?.length) throw new EmptyResultError('chanmama card', `id=${id}`);
    const observedAt = capturedAt();
    return payload.trend.rows.map((row) => {
      const volume = metric(row, 'volume'); const amount = metric(row, 'amount');
      return {
        date: shanghaiDate(row.time_node) || row.date || null, promotionId: id,
        productVolume: volume.value, productAmount: amount.value, volumeValueType: volume.valueType, amountValueType: amount.valueType,
        windowStart: payload.overview?.dateRange?.[0] || null, windowEnd: payload.overview?.dateRange?.[1] || null,
        observedAt, sourcePage,
        detailsJson: JSON.stringify({ volumeBand: volume.band, amountBand: amount.band, overview: payload.overview?.data || null, sourcePlatform: 'chanmama', evidenceGrade: 'B-third-party-estimate' }),
      };
    });
  },
});
