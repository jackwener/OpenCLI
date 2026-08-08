import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
  capturedAt,
  cleanNumber,
  douyinContentId,
  gotoAuthorDetail,
  integerInRange,
  isoTime,
  metric,
  poll,
  requireId,
  stableDouyinUrl,
} from './_shared.js';

const ALLOWED_DAYS = [1, 7, 15, 30, 90, 180, 270, 360, 365, 540, 730, 1100];
const SOURCES = {
  homepage: 1,
  paid: 2,
};

function parseBoolean(value, name) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ArgumentError(`${name} must be true or false`);
}

cli({
  site: 'chanmama',
  name: 'author-sales-videos',
  description: '按发布时间读取达人周期内动销视频，可区分全部动销与周期内新发布',
  access: 'read',
  example: 'opencli chanmama author-sales-videos h33CrCFAhf4vwlFPqV5Qa21xTCnoYbhL --days 30 --new-only true --source homepage --limit 20 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈达人 author_id' },
    { name: 'days', type: 'int', default: 30, help: '周期：1、7、15、30、90、180、270、360、365、540、730或1100天' },
    { name: 'new-only', type: 'boolean', default: false, help: '仅返回周期内新发布且产生动销的视频' },
    { name: 'source', type: 'string', default: 'homepage', help: '视频来源：homepage（主页带货）或 paid（投放）' },
    { name: 'page', type: 'int', default: 1, help: '页码，从 1 开始；用于遍历周期内动销视频完整列表' },
    { name: 'limit', type: 'int', default: 20, help: '返回视频数量，范围 1-50' },
  ],
  columns: [
    'rank', 'videoId', 'authorId', 'nickname', 'followerCount', 'title',
    'publishTime', 'periodVolume', 'periodAmount', 'productTitle', 'videoUrl',
    'detailsJson',
  ],
  func: async (page, args) => {
    const id = requireId(args.id);
    const days = integerInRange(args.days ?? 30, 'days', 1, 1100);
    if (!ALLOWED_DAYS.includes(days)) {
      throw new ArgumentError(`days must be one of: ${ALLOWED_DAYS.join(', ')}`);
    }
    const newOnly = parseBoolean(args['new-only'] ?? false, 'new-only');
    const source = String(args.source ?? 'homepage').trim().toLowerCase();
    if (!Object.hasOwn(SOURCES, source)) {
      throw new ArgumentError(`source must be one of: ${Object.keys(SOURCES).join(', ')}`);
    }
    const pageNumber = integerInRange(args.page ?? 1, 'page', 1, 1000);
    const limit = integerInRange(args.limit ?? 20, 'limit', 1, 50);
    const sourcePage = await gotoAuthorDetail(page, id, 'aweme');
    const requestToken = capturedAt();
    const payload = await poll(page, async () => page.evaluate(`async () => {
      const seen = new Set();
      let analysis = null;
      let record = null;
      for (const element of document.querySelectorAll('*')) {
        let vm = element.__vue__;
        while (vm && !seen.has(vm)) {
          seen.add(vm);
          if (vm.$options?.name === 'aweme-analysis') analysis = vm;
          if (vm.$options?.name === 'aweme-record') record = vm;
          vm = vm.$parent;
        }
      }
      if (!analysis || !record) return { done: false, reason: 'component' };
      const days = ${days};
      const selected = (analysis.rangList || []).find((item) => Number(item?.[3]) === days);
      if (!selected || !Array.isArray(selected[1]) || selected[1].length !== 2) {
        return { done: false, reason: 'date-range' };
      }
      const desired = {
        requestToken: ${JSON.stringify(requestToken)},
        days,
        dateRange: selected[1].slice(),
        videoType: 1,
        adType: ${SOURCES[source]},
        newOnly: ${newOnly},
        sort: 'time',
        orderBy: true,
        page: ${pageNumber},
        pageSize: 50,
      };
      const signature = JSON.stringify(desired);
      if (record.__opencliAuthorSalesVideosSignature !== signature) {
        record.__opencliAuthorSalesVideosSignature = signature;
        record.__opencliAuthorSalesVideosPayload = null;
        analysis.dateRange = desired.dateRange.slice();
        await analysis.$nextTick();
        record.videoType = desired.videoType;
        record.adType = desired.adType;
        record.onlyNewAweme = desired.newOnly;
        await record.$nextTick();
        record.formData.keyword = '';
        record.formData.sort = desired.sort;
        record.formData.orderBy = desired.orderBy;
        record.formData.page_size = desired.pageSize;
        await record.$nextTick();
        record.formData.page = desired.page;
        record.dataList = [];
        record.pageInfo.totalCount = 0;
        try {
          await record.getMovingList(false);
        } catch (error) {
          return { done: false, reason: error?.message || 'getMovingList' };
        }
        const rows = Array.isArray(record.dataList) ? record.dataList.slice(0, ${limit}) : [];
        const form = record.getMovingFormData();
        record.__opencliAuthorSalesVideosPayload = {
          rows,
          totalCount: Number(record.pageInfo?.totalCount ?? 0),
          form,
          requestedDateRange: desired.dateRange,
          author: {
            nickname: record.author_info?.nickname ?? null,
            followerCount: record.author_info?.follower_count ?? null,
          },
        };
      }
      const cached = record.__opencliAuthorSalesVideosPayload;
      const loading = Boolean(record.isLoading ?? record.loading);
      return {
        done: !loading && Boolean(cached),
        rows: cached?.rows || [],
        totalCount: cached?.totalCount ?? null,
        form: cached?.form || null,
        requestedDateRange: cached?.requestedDateRange || null,
        author: cached?.author || null,
        reason: 'rows=' + String(cached?.rows?.length ?? 0) + ' loading=' + String(loading),
      };
    }`), (value) => value?.done, 24);

    if (!payload?.done) {
      throw new CommandExecutionError(`author sales videos did not load: ${payload?.reason || `id=${id}`}`);
    }
    const expected = {
      author_id: id,
      start_time: payload.requestedDateRange?.[0],
      end_time: payload.requestedDateRange?.[1],
      ad_type: SOURCES[source],
      is_new_publish: newOnly ? 1 : 0,
      sort: 'time',
      orderby: 'desc',
      page: pageNumber,
      size: 50,
    };
    const mismatches = Object.entries(expected)
      .filter(([key, value]) => payload.form?.[key] !== value)
      .map(([key, value]) => `${key}=${payload.form?.[key]} (expected ${value})`);
    if (mismatches.length > 0) {
      throw new CommandExecutionError(`author sales video filter mismatch: ${mismatches.join(', ')}`);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
      throw new EmptyResultError(
        'chanmama author-sales-videos',
        `authorId=${id}, days=${days}, newOnly=${newOnly}, source=${source}`,
      );
    }

    const observedAt = capturedAt();
    return payload.rows.map((row, index) => {
      const volume = metric(row, 'volume');
      const amount = metric(row, 'amount');
      const shareUrl = row.aweme_url || null;
      return {
        rank: (pageNumber - 1) * 50 + index + 1,
        videoId: row.aweme_id,
        authorId: id,
        nickname: payload.author?.nickname ?? null,
        followerCount: cleanNumber(payload.author?.followerCount),
        title: row.aweme_name || null,
        publishTime: isoTime(row.aweme_create_time),
        periodVolume: volume.value,
        periodAmount: amount.value,
        productTitle: row.product_title || row.aweme_relate_info?.product_info?.title || null,
        videoUrl: stableDouyinUrl(shareUrl),
        detailsJson: JSON.stringify({
          douyinContentId: douyinContentId(shareUrl),
          douyinAuthorId: row.author_id ? String(row.author_id) : null,
          contentType: /\/(?:share\/)?note\//.test(String(shareUrl)) ? 'note' : 'video',
          promotionIds: Array.isArray(row.promotion_id) ? row.promotion_id : [],
          adType: cleanNumber(row.ad_type),
          durationSec: cleanNumber(row.duration),
          likes: cleanNumber(row.digg_count),
          comments: cleanNumber(row.comment_count),
          shares: cleanNumber(row.forward_count),
          coverUrl: row.aweme_cover || null,
          shareUrl,
          valueTypes: { volume: volume.valueType, amount: amount.valueType },
          bands: { volume: volume.band, amount: amount.band },
          periodDays: days,
          windowStart: payload.form.start_time,
          windowEnd: payload.form.end_time,
          newOnly,
          sourceFilter: source,
          page: pageNumber,
          pageSize: 50,
          sortApplied: 'publishTime',
          orderApplied: 'desc',
          totalCount: payload.totalCount,
          observedAt,
          sourcePlatform: 'chanmama',
          sourcePage,
          evidenceGrade: 'B-third-party-estimate',
          causalUnknowns: ['naturalVsPaidSales', 'liveRoomSpillover', 'refundAdjustedSales'],
        }),
      };
    });
  },
});
