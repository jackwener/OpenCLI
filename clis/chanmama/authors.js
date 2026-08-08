import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  CommandExecutionError,
  EmptyResultError,
  capturedAt,
  cleanNumber,
  gotoDetail,
  integerInRange,
  metric,
  poll,
  requireId,
} from './_shared.js';

cli({
  site: 'chanmama',
  name: 'authors',
  description: '读取商品近30天关联达人，拆分短视频/直播成交并保留重复成交线索',
  access: 'read',
  example: 'opencli chanmama authors Oifq5_IBXNJaS6yWtMXo9U2tveAEURop --limit 20 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' },
    { name: 'limit', type: 'int', default: 20, help: '返回达人数量，范围 1-50' },
  ],
  columns: ['rank', 'authorId', 'nickname', 'douyinId', 'followerCount', 'productVolume', 'productAmount', 'relatedVideos', 'relatedLives', 'channelType', 'flagsJson', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id);
    const limit = integerInRange(args.limit ?? 20, 'limit', 1, 50);
    const sourcePage = await gotoDetail(page, id, 'author');
    const payload = await poll(page, async () => page.evaluate(`async () => {
      const seen = new Set(); let overview = null; let tableVm = null;
      for (const element of document.querySelectorAll('*')) {
        let vm = element.__vue__;
        while (vm && !seen.has(vm)) {
          seen.add(vm);
          if (vm.$options?.name === 'author-analysis') {
            if (Array.isArray(vm.dataList)) tableVm = vm;
            else if (vm.overviewData) overview = { data: vm.overviewData, dateRange: vm.dateRange };
          }
          vm = vm.$parent;
        }
      }
      if (!tableVm) return { ready: false, reason: 'component' };
      const desired = { page: 1, size: 30, sort: 'volume', orderBy: true, limit: ${limit} };
      const signature = JSON.stringify(desired);
      if (tableVm.__opencliAuthorsSignature !== signature) {
        tableVm.__opencliAuthorsSignature = signature;
        tableVm.__opencliAuthorsPayload = null;
        const collected = [];
        let totalCount = null;
        let fetchedPages = 0;
        const fetchPlan = [];
        const appendUnique = () => {
          const uniqueRows = [];
          const authorIds = new Set();
          for (const row of collected) {
            if (!row?.author_id || authorIds.has(row.author_id)) continue;
            authorIds.add(row.author_id);
            uniqueRows.push(row);
          }
          return uniqueRows;
        };
        const fetchPage = async (pageNumber, pageSize) => {
          tableVm.page = pageNumber;
          tableVm.size = pageSize;
          tableVm.sort = desired.sort;
          tableVm.orderBy = desired.orderBy;
          await tableVm.getData();
          fetchedPages += 1;
          fetchPlan.push({ page: pageNumber, size: pageSize });
          const pageRows = Array.isArray(tableVm.dataList) ? tableVm.dataList : [];
          totalCount = Number(tableVm.pageInfo?.totalCount ?? tableVm.totalCount);
          collected.push(...pageRows);
          return pageRows;
        };
        try {
          const primaryPages = Math.ceil(desired.limit / desired.size);
          for (let pageNumber = 1; pageNumber <= primaryPages; pageNumber += 1) {
            const pageRows = await fetchPage(pageNumber, desired.size);
            if (pageRows.length < desired.size) break;
          }
          let expectedRows = Number.isFinite(totalCount) && totalCount < desired.limit ? totalCount : desired.limit;
          let uniqueRows = appendUnique();
          for (const fallbackSize of [20, 10]) {
            if (uniqueRows.length >= expectedRows) break;
            const fallbackPages = Math.ceil(expectedRows / fallbackSize);
            for (let pageNumber = 1; pageNumber <= fallbackPages; pageNumber += 1) {
              await fetchPage(pageNumber, fallbackSize);
              uniqueRows = appendUnique();
              if (uniqueRows.length >= expectedRows) break;
            }
          }
          tableVm.page = desired.page;
          tableVm.size = desired.size;
          tableVm.sort = desired.sort;
          tableVm.orderBy = desired.orderBy;
        } catch (error) {
          return { ready: false, reason: error?.message || 'getData' };
        }
        const uniqueRows = appendUnique();
        const expectedRows = Number.isFinite(totalCount) && totalCount < desired.limit ? totalCount : desired.limit;
        tableVm.__opencliAuthorsPayload = {
          rows: uniqueRows.slice(0, desired.limit),
          totalCount: Number.isFinite(totalCount) ? totalCount : null,
          expectedRows,
          fetchedPages,
          fetchPlan,
        };
      }
      const cached = tableVm.__opencliAuthorsPayload;
      const loading = Boolean(tableVm.isLoading ?? tableVm.loading);
      const rows = Array.isArray(cached?.rows) ? cached.rows : [];
      return {
        ready: !loading && rows.length >= (cached?.expectedRows ?? desired.limit),
        overview,
        rows,
        totalCount: cached?.totalCount ?? null,
        fetchedPages: cached?.fetchedPages ?? 0,
        fetchPlan: cached?.fetchPlan ?? [],
        actual: {
          page: desired.page,
          size: tableVm.size ?? null,
          sort: tableVm.sort ?? null,
          order: tableVm.orderBy === true ? 'desc' : 'asc',
        },
        reason: 'rows=' + rows.length + ' expected=' + String(cached?.expectedRows) + ' loading=' + String(loading)
      };
    }`), (value) => value?.ready, 24);
    if (!payload?.ready) throw new EmptyResultError('chanmama authors', payload?.reason || `id=${id}`);
    if (payload.actual?.page !== 1 || payload.actual?.size !== 30 || payload.actual?.sort !== 'volume' || payload.actual?.order !== 'desc') {
      throw new CommandExecutionError(`author list mismatch: expected=page1/size30/volume/desc, actual=page${payload.actual?.page}/size${payload.actual?.size}/${payload.actual?.sort}/${payload.actual?.order}`);
    }
    const observedAt = capturedAt();
    return payload.rows.map((row, index) => {
      const total = metric(row, 'volume'); const amount = metric(row, 'amount');
      const video = metric(row, 'aweme_volume'); const live = metric(row, 'live_volume');
      return {
        rank: index + 1,
        authorId: row.author_id,
        nickname: row.nickname,
        douyinId: row.unique_id || row.short_id || null,
        followerCount: cleanNumber(row.follower_count),
        productVolume: total.value,
        productAmount: amount.value,
        relatedVideos: cleanNumber(row.aweme_count),
        relatedLives: cleanNumber(row.room_count),
        channelType: row.main_bring_product_type === 2 ? 'live-led' : row.main_bring_product_type === 1 ? 'video-led' : 'unknown',
        flagsJson: JSON.stringify({
          hasContact: Boolean(row.has_contact), highCommissionLevel: cleanNumber(row.jx_level),
          isNewIn180Days: row.is_new_in_180_days === 1, isRoyaltyAuthor: row.is_royalty_author === 1,
          hasOwnBrandCode: Boolean(row.self_brand_code), liveRoomStatus: row.live_room_status ?? null,
        }),
        detailsJson: JSON.stringify({
          activeFans: cleanNumber(row.active_fans), category: row.label || null,
          reputationScore: cleanNumber(row.reputation?.score),
          videoVolume: video.value, liveVolume: live.value,
          repeatVideoEvidenceCount: Array.isArray(row.a) ? row.a.length : 0,
          repeatLiveEvidenceCount: Array.isArray(row.r) ? row.r.length : 0,
          topVideoEvidence: Array.isArray(row.a) ? row.a.slice(0, 5) : [],
          topLiveEvidence: Array.isArray(row.r) ? row.r.slice(0, 5) : [],
          valueTypes: { total: total.valueType, amount: amount.valueType, video: video.valueType, live: live.valueType },
          bands: { total: total.band, amount: amount.band, video: video.band, live: live.band },
          overview: payload.overview?.data || null, totalCount: payload.totalCount, fetchedPages: payload.fetchedPages,
          fetchPlan: payload.fetchPlan,
          windowStart: payload.overview?.dateRange?.[0] || null,
          windowEnd: payload.overview?.dateRange?.[1] || null, observedAt, sourcePlatform: 'chanmama', sourcePage,
          evidenceGrade: 'B-third-party-estimate',
        }),
      };
    });
  },
});
