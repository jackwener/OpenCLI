import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  CommandExecutionError,
  EmptyResultError,
  capturedAt,
  cleanNumber,
  douyinContentId,
  gotoVideoDetail,
  isoTime,
  metric,
  poll,
  requireId,
  stableDouyinUrl,
} from './_shared.js';

function durationSeconds(value) {
  const number = cleanNumber(value);
  if (number === null) return null;
  return number >= 1000 ? number / 1000 : number;
}

function compactSameProductVideo(item) {
  const aweme = item?.aweme_info || item?.awemeInfo || item?.aweme || item || {};
  const author = item?.author_info || item?.authorInfo || item?.author || {};
  const shareUrl = aweme.aweme_url || aweme.url || null;
  return {
    relatedVideoId: aweme.aweme_id || null,
    relatedDouyinVideoId: douyinContentId(shareUrl),
    relatedVideoUrl: stableDouyinUrl(shareUrl),
    relatedTitle: aweme.aweme_title || aweme.title || null,
    relatedPublishTime: isoTime(aweme.aweme_create_time || aweme.aweme_careate_time || aweme.create_time),
    relatedAuthorId: author.author_id || null,
    relatedDouyinAuthorId: author.unique_id || author.short_id || null,
    relatedNickname: author.nickname || aweme.nickname || null,
    estimatedProductVolume: metric(aweme, 'volume').value,
    estimatedProductAmount: metric(aweme, 'amount').value,
    likeCount: cleanNumber(aweme.digg_count ?? aweme.aweme_digg_count),
    commentCount: cleanNumber(aweme.comment_count ?? aweme.aweme_comment_count),
    shareCount: cleanNumber(aweme.share_count ?? aweme.aweme_share_count),
  };
}

function compactTrend(items, refreshedAt) {
  const cutoff = cleanNumber(refreshedAt);
  return (items || []).map((item) => ({
    observedTimestamp: cleanNumber(item.recordedAt),
    observedTime: isoTime(item.recordedAt),
    viewCount: cleanNumber(item.viewCount),
    likeCount: cleanNumber(item.likeCount),
    commentCount: cleanNumber(item.commentCount),
    shareCount: cleanNumber(item.shareCount),
    collectCount: cleanNumber(item.collectCount),
  })).filter((item) => (cutoff === null || item.observedTimestamp <= cutoff)
    && [item.viewCount, item.likeCount, item.commentCount, item.shareCount, item.collectCount].some((value) => value !== null))
    .map(({ observedTimestamp, ...item }) => item);
}

function compactConversionTrend(chart) {
  const points = (items) => (items || []).map((item) => ({
    time: isoTime(item.time_node), value: cleanNumber(item.value),
  })).filter((item) => item.value !== null);
  return { ipm: points(chart?.ipmv), gpm: points(chart?.gpmv) };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

cli({
  site: 'chanmama',
  name: 'video',
  description: '读取单条视频详情、稳定抖音链接、作者基线、成交互动趋势、标签音乐和同款热视频',
  access: 'read',
  example: 'opencli chanmama video D4GBpkUy-KmHL6f1tQQmGF3nyfY0zHyV -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [{ name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈aweme_id；由videos命令返回' }],
  columns: ['videoId', 'douyinVideoId', 'authorId', 'nickname', 'followerCount', 'title', 'publishTime', 'views', 'productVolume', 'productAmount', 'videoUrl', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id);
    const sourcePage = await gotoVideoDetail(page, id);
    const payload = await poll(page, async () => page.evaluate(`() => {
      let detail = null; let base = null; let diagnosis = null; const sameProduct = []; let comments = null;
      const seen = new Set();
      for (const element of document.querySelectorAll('*')) {
        let vm = element.__vue__;
        while (vm && !seen.has(vm)) {
          seen.add(vm);
          const name = vm.$options?.name;
          if (name === 'aweme-detail-page' && vm.awemeInfo?.aweme) {
            detail = {
              aweme: vm.awemeInfo.aweme,
              author: vm.awemeInfo.author,
              demoInfo: vm.awemeInfo.demo_info,
              refreshCount: vm.awemeInfo.refresh_count,
              transferStatus: vm.awemeInfo.transfer_status,
              warmRoomIds: vm.awemeInfo.warm_room_ids
            };
          }
          if (name === 'base-data-box') {
            base = {
              music: vm.musicInfo,
              trend: {
                add: Array.isArray(vm.trendData?.add) ? vm.trendData.add.map((item) => ({
                  recordedAt: item.update_time, viewCount: item.play_count, likeCount: item.digg_count,
                  commentCount: item.comment_count, shareCount: item.share_count, collectCount: item.collect_count
                })) : [],
                total: Array.isArray(vm.trendData?.total) ? vm.trendData.total.map((item) => ({
                  recordedAt: item.update_time, viewCount: item.play_count, likeCount: item.digg_count,
                  commentCount: item.comment_count, shareCount: item.share_count, collectCount: item.collect_count
                })) : [],
                refreshedAt: vm.trendData?.update_time || null
              },
              conversionTrend: vm.mvChartData,
              dateRange: vm.dateRange,
              timeLevel: vm.timeLevel
            };
          }
          if (name === 'diagnose-box') diagnosis = vm.awemeDiagnoseInfo;
          if (name === 'aweme-list-box' && vm.itemData?.aweme_info && sameProduct.length < 4) sameProduct.push(vm.itemData);
          if (/comment/i.test(name || '') && !comments) {
            const candidate = vm.commentAnalysisData || vm.analysisData || vm.dataList;
            if (candidate) comments = candidate;
          }
          vm = vm.$parent;
        }
      }
      return {
        ready: Boolean(detail?.aweme?.aweme_id && base), detail, base, diagnosis, sameProduct, comments,
        reason: detail?.aweme?.aweme_id ? (base ? 'ready' : 'base-data-box') : 'detail-component'
      };
    }`), (value) => value?.ready, 24);
    if (!payload?.ready) throw new EmptyResultError('chanmama video', payload?.reason || `id=${id}`);
    const aweme = payload.detail.aweme || {};
    const author = payload.detail.author || {};
    if (String(aweme.aweme_id) !== id) throw new CommandExecutionError(`video id mismatch: expected=${id}, actual=${aweme.aweme_id}`);

    const shareUrl = aweme.aweme_url || aweme.url || null;
    const douyinVideoId = douyinContentId(shareUrl);
    const productVolume = metric(aweme, 'total_volume');
    const fallbackVolume = metric(aweme, 'volume');
    const productAmount = metric(aweme, 'amount');
    const observedAt = capturedAt();
    const music = payload.base?.music || {};
    const diagnosis = payload.diagnosis || {};
    return [{
      videoId: aweme.aweme_id,
      douyinVideoId,
      authorId: author.author_id || aweme.author_id || null,
      nickname: author.nickname || aweme.nickname || null,
      followerCount: cleanNumber(author.follower_count ?? aweme.follower_count),
      title: aweme.aweme_title || aweme.title || null,
      publishTime: isoTime(aweme.aweme_create_time || aweme.aweme_careate_time || aweme.create_time),
      views: cleanNumber(aweme.play_count_v2 ?? aweme.play_count),
      productVolume: productVolume.value ?? fallbackVolume.value,
      productAmount: productAmount.value,
      videoUrl: stableDouyinUrl(shareUrl),
      detailsJson: JSON.stringify({
        shareUrl,
        coverUrl: aweme.aweme_cover || aweme.cover || null,
        durationSec: durationSeconds(aweme.duration ?? aweme.aweme_duration),
        likes: cleanNumber(aweme.digg_count ?? aweme.aweme_digg_count),
        comments: cleanNumber(aweme.comment_count ?? aweme.aweme_comment_count),
        shares: cleanNumber(aweme.share_count ?? aweme.aweme_share_count),
        collects: cleanNumber(aweme.collect_count),
        valueTypes: {
          productVolume: productVolume.value !== null ? productVolume.valueType : fallbackVolume.valueType,
          productAmount: productAmount.valueType,
        },
        bands: {
          productVolume: productVolume.band || fallbackVolume.band,
          productAmount: productAmount.band,
        },
        liftVsAuthorAveragePct: {
          likes: cleanNumber(aweme.digg_exceed_avg_rate),
          comments: cleanNumber(aweme.comment_exceed_avg_rate),
          shares: cleanNumber(aweme.share_exceed_avg_rate),
        },
        authorBaseline: {
          averageViews: cleanNumber(author.play_count_avg),
          averageLikes: cleanNumber(author.digg_avg),
          averageComments: cleanNumber(author.comment_avg),
          averageShares: cleanNumber(author.share_avg),
          day90AverageViews: cleanNumber(author.aweme_play_count_avg_90),
          day90AverageLikes: cleanNumber(author.aweme_digg_avg_90),
          day90AverageComments: cleanNumber(author.aweme_comment_avg_90),
          day90AverageShares: cleanNumber(author.aweme_share_avg_90),
          day90AverageCollects: cleanNumber(author.aweme_collect_count_avg_90),
          day90AverageProductVolume: cleanNumber(author.aweme_volume_avg_90_text_cmm_ind),
          day90AverageProductAmount: cleanNumber(author.aweme_amount_avg_90_text_cmm_ind),
          day90AverageIpm: cleanNumber(author.aweme_ipmv_avg_90),
        },
        durationBand: aweme.duration_dimension || null,
        blueWords: aweme.blue_words || [],
        contentTags: aweme.vot || [],
        singleTags: aweme.single_tags || [],
        speechText: aweme.aweme_speech || null,
        contentAnalyzer: aweme.content_analyzer || null,
        scriptLabels: aweme.script_labels || null,
        productInfo: aweme.product_info || [],
        platformPromotionIds: aweme.promotion_id || [],
        music: {
          musicId: music.music_id || null,
          title: music.title || null,
          author: music.author || null,
          userCount: cleanNumber(music.user_count),
          hotValue: cleanNumber(music.hot_value),
          auditionDurationSec: durationSeconds(music.audition_duration),
          labels: parseJsonArray(music.label_t),
          temporaryPlayUrl: music.play_url || null,
        },
        diagnosis: {
          label: diagnosis.label || null,
          score: cleanNumber(diagnosis.score),
          verticalRank: cleanNumber(diagnosis.vertical_rank),
          horizontalRank: cleanNumber(diagnosis.horizontal_rank),
          sameLabelVideoCountBand: diagnosis.same_label_aweme_nums || null,
          timeWindow: diagnosis.time_node_section || null,
          refreshedAt: isoTime(diagnosis.refresh_time),
        },
        engagementTrend: {
          additions: compactTrend(payload.base?.trend?.add, payload.base?.trend?.refreshedAt),
          totals: compactTrend(payload.base?.trend?.total, payload.base?.trend?.refreshedAt),
          refreshedAt: isoTime(payload.base?.trend?.refreshedAt),
        },
        conversionTrend: compactConversionTrend(payload.base?.conversionTrend),
        trendWindow: payload.base?.dateRange || null,
        trendGranularity: payload.base?.timeLevel || null,
        sameProductTopVideos: (payload.sameProduct || []).map(compactSameProductVideo),
        commentAnalysis: payload.comments || null,
        demoInfo: payload.detail.demoInfo || null,
        refreshCount: cleanNumber(payload.detail.refreshCount),
        transferStatus: payload.detail.transferStatus ?? null,
        exist: aweme.exist ?? null,
        adType: aweme.ad_type ?? null,
        observedAt,
        sourcePlatform: 'chanmama',
        sourcePage,
        evidenceGrade: 'B-third-party-estimate',
        manualReviewRequired: ['publicAccessible', 'paidTrafficAttribution', 'commentIntent', 'hookStructure', 'visualProof', 'templateCluster', 'copyrightAndCompliance'],
      }),
    }];
  },
});
