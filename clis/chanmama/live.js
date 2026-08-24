import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, capturedAt, cleanNumber, gotoDetail, integerInRange, isoTime, metric, poll, requireId } from './_shared.js';

cli({
  site: 'chanmama', name: 'live', description: '读取商品近30天关联直播间及观看、成交和讲解线索', access: 'read',
  example: 'opencli chanmama live Oifq5_IBXNJaS6yWtMXo9U2tveAEURop --limit 10 -f json',
  domain: 'chanmama.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
  siteSession: 'persistent', defaultWindowMode: 'background',
  args: [{ name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' }, { name: 'limit', type: 'int', default: 10, help: '返回直播数量，范围 1-50' }],
  columns: ['rank', 'liveId', 'roomTitle', 'authorId', 'nickname', 'followerCount', 'startTime', 'productVolume', 'productAmount', 'totalViewers', 'peakViewers', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id); const limit = integerInRange(args.limit ?? 10, 'limit', 1, 50);
    const sourcePage = await gotoDetail(page, id, 'live');
    const payload = await poll(page, async () => page.evaluate(`() => {
      const seen = new Set(); let overview = null; let table = null;
      for (const element of document.querySelectorAll('*')) {
        const vm = element.__vue__; if (!vm || seen.has(vm)) continue; seen.add(vm);
        if (vm.$options?.name === 'live-analysis') overview = { data: vm.overview || vm.overviewData, dateRange: vm.dateRange };
        if (vm.$options?.name === 'live-table') table = { rows: vm.dataList?.slice(0, ${limit}) || [], totalCount: vm.totalCount || vm.pageInfo?.totalCount, loading: vm.isLoading };
      }
      return { overview, table };
    }`), (value) => value?.table?.rows?.length > 0 && !value.table.loading, 18);
    if (!payload?.table?.rows?.length) throw new EmptyResultError('chanmama live', `id=${id}`);
    const observedAt = capturedAt();
    return payload.table.rows.map((row, index) => {
      const volume = metric(row, 'volume'); const amount = metric(row, 'amount');
      return {
        rank: index + 1, liveId: row.live_id || row.room_id, roomTitle: row.room_title || null,
        authorId: row.author_id, nickname: row.nickname, followerCount: cleanNumber(row.follower_count),
        startTime: isoTime(row.begin_time), productVolume: volume.value,
        productAmount: amount.value, totalViewers: cleanNumber(row.total_user), peakViewers: cleanNumber(row.user_peak),
        detailsJson: JSON.stringify({
          durationSec: cleanNumber(row.duration), hasClip: row.has_fragment === 1 || Boolean(row.has_speak_clip), liveUrl: row.live_url || null,
          finishTime: isoTime(row.room_finish_time), roomTicketCount: cleanNumber(row.room_ticket_count), bubbleViews: cleanNumber(row.bubble_pv),
          introduceDurationSec: cleanNumber(row.introduce_duration), explainCount: cleanNumber(row.explain_cnt), explainDurationSec: cleanNumber(row.explain_duration),
          valueTypes: { volume: volume.valueType, amount: amount.valueType }, bands: { volume: volume.band, amount: amount.band },
          overview: payload.overview?.data || null, totalCount: payload.table.totalCount,
          windowStart: payload.overview?.dateRange?.[0] || null, windowEnd: payload.overview?.dateRange?.[1] || null,
          observedAt, sourcePlatform: 'chanmama', sourcePage, evidenceGrade: 'B-third-party-estimate',
        }),
      };
    });
  },
});
