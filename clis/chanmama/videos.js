import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
  capturedAt,
  cleanNumber,
  douyinContentId,
  gotoDetail,
  integerInRange,
  isoTime,
  metric,
  poll,
  requireId,
  stableDouyinUrl,
} from './_shared.js';

const SORTS = {
  volume: 'volume',
  amount: 'amount',
  publishTime: 'aweme_careate_time',
  likes: 'aweme_digg_count',
  comments: 'aweme_comment_count',
  shares: 'aweme_share_count',
};

cli({
  site: 'chanmama',
  name: 'videos',
  description: '读取商品成交视频，支持只看有销量、发布时间和成交互动排序',
  access: 'read',
  example: 'opencli chanmama videos Oifq5_IBXNJaS6yWtMXo9U2tveAEURop --has-sales true --sort publishTime --order desc --limit 10 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' },
    { name: 'sort', type: 'string', default: 'volume', help: 'volume、amount、publishTime、likes、comments或shares' },
    { name: 'order', type: 'string', default: 'desc', help: 'desc或asc' },
    { name: 'has-sales', type: 'boolean', default: false, help: '只返回有本品销量的视频' },
    { name: 'limit', type: 'int', default: 10, help: '返回视频数量，范围 1-50' },
  ],
  columns: ['rank', 'videoId', 'authorId', 'nickname', 'followerCount', 'title', 'publishTime', 'productVolume', 'productAmount', 'estimatedExposure', 'videoUrl', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id);
    const sort = String(args.sort || 'volume').trim();
    const order = String(args.order || 'desc').trim().toLowerCase();
    const hasSales = args['has-sales'] === true || String(args['has-sales']).toLowerCase() === 'true';
    const limit = integerInRange(args.limit ?? 10, 'limit', 1, 50);
    if (!Object.hasOwn(SORTS, sort)) throw new ArgumentError(`unsupported sort: ${sort}`);
    if (!['asc', 'desc'].includes(order)) throw new ArgumentError('order must be asc or desc');

    const siteSort = SORTS[sort];
    const sourcePage = await gotoDetail(page, id, 'aweme');
    const payload = await poll(page, async () => page.evaluate(`async () => {
      let overview = null; let tableVm = null;
      const seen = new Set();
      for (const element of document.querySelectorAll('*')) {
        let vm = element.__vue__;
        while (vm && !seen.has(vm)) {
          seen.add(vm);
          if (vm.$options?.name === 'aweme-analysis') overview = { data: vm.overview, dateRange: vm.dateRange };
          if (vm.$options?.name === 'aweme-table') tableVm = vm;
          vm = vm.$parent;
        }
      }
      if (!tableVm) return { ready: false, reason: 'component' };
      const desired = {
        keyword: '', order: ${order === 'desc'}, orderby: ${JSON.stringify(siteSort)}, page: 1, size: 50,
        showVolume: ${hasSales}
      };
      const signature = JSON.stringify(desired);
      if (tableVm.__opencliSignature !== signature) {
        tableVm.__opencliSignature = signature;
        tableVm.showVolume = desired.showVolume;
        Object.assign(tableVm.formData, {
          keyword: desired.keyword, order: desired.order, orderby: desired.orderby,
          page: desired.page, size: desired.size
        });
        try { await tableVm.getData(); } catch (error) {
          return { ready: false, reason: error?.message || 'getData' };
        }
      }
      const loading = Boolean(tableVm.isLoading ?? tableVm.loading);
      const rows = Array.isArray(tableVm.dataList) ? tableVm.dataList.slice(0, ${limit}) : [];
      return {
        ready: !loading && rows.length > 0,
        overview,
        rows,
        totalCount: tableVm.totalCount ?? tableVm.pageInfo?.totalCount ?? null,
        actual: {
          sort: tableVm.formData?.orderby ?? null,
          order: tableVm.formData?.order === true ? 'desc' : 'asc',
          hasSales: Boolean(tableVm.showVolume)
        },
        reason: 'rows=' + rows.length + ' loading=' + String(loading)
      };
    }`), (value) => value?.ready, 24);
    if (!payload?.ready) throw new EmptyResultError('chanmama videos', payload?.reason || `id=${id}`);
    if (payload.actual?.sort !== siteSort || payload.actual?.order !== order || payload.actual?.hasSales !== hasSales) {
      throw new CommandExecutionError(`video filter mismatch: expected=${siteSort}/${order}/hasSales=${hasSales}, actual=${payload.actual?.sort}/${payload.actual?.order}/hasSales=${payload.actual?.hasSales}`);
    }

    const observedAt = capturedAt();
    return payload.rows.map((row, index) => {
      const volume = metric(row, 'volume');
      const amount = metric(row, 'amount');
      const shareUrl = row.aweme_url || row.url || null;
      return {
        rank: index + 1,
        videoId: row.aweme_id,
        authorId: row.author_id,
        nickname: row.nickname,
        followerCount: cleanNumber(row.follower_count),
        title: row.aweme_title || row.title || null,
        publishTime: isoTime(row.aweme_careate_time || row.create_time),
        productVolume: volume.value,
        productAmount: amount.value,
        estimatedExposure: cleanNumber(row.play_count_v2),
        videoUrl: stableDouyinUrl(shareUrl),
        detailsJson: JSON.stringify({
          douyinVideoId: douyinContentId(shareUrl),
          douyinAuthorId: row.dy_id || row.unique_id || null,
          durationSec: cleanNumber(row.aweme_duration) !== null ? cleanNumber(row.aweme_duration) / 1000 : cleanNumber(row.duration),
          likes: cleanNumber(row.aweme_digg_count ?? row.likes),
          comments: cleanNumber(row.aweme_comment_count ?? row.comments),
          shares: cleanNumber(row.aweme_share_count ?? row.shares),
          collects: cleanNumber(row.collect_count),
          tags: row.vot || row.tags || [],
          adType: row.ad_type ?? null,
          shareUrl,
          coverUrl: row.aweme_cover || null,
          valueTypes: { volume: volume.valueType, amount: amount.valueType },
          bands: { volume: volume.band, amount: amount.band },
          sortApplied: sort,
          siteSortApplied: siteSort,
          orderApplied: order,
          hasSalesOnly: hasSales,
          overview: payload.overview?.data || null,
          totalCount: payload.totalCount,
          windowStart: payload.overview?.dateRange?.[0] || null,
          windowEnd: payload.overview?.dateRange?.[1] || null,
          observedAt,
          sourcePlatform: 'chanmama',
          sourcePage,
          evidenceGrade: 'B-third-party-estimate',
          manualReviewRequired: ['publicAccessible', 'productRelevance', 'paidAdStatus', 'templateCluster', 'creatorBaseline'],
        }),
      };
    });
  },
});
