import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, capturedAt, gotoDetail, poll, requireId } from './_shared.js';

cli({
  site: 'chanmama', name: 'audience', description: '分别读取商品近30天观众画像、成交画像和相关视频内容偏好', access: 'read',
  example: 'opencli chanmama audience Oifq5_IBXNJaS6yWtMXo9U2tveAEURop -f json',
  domain: 'chanmama.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
  siteSession: 'persistent', defaultWindowMode: 'background',
  args: [{ name: 'id', type: 'string', positional: true, required: true, help: '蝉妈妈promotion_id' }],
  columns: ['promotionId', 'profileType', 'summary', 'genderJson', 'ageJson', 'provinceJson', 'cityJson', 'contentPreferenceL1Json', 'contentPreferenceL2Json', 'windowStart', 'windowEnd', 'detailsJson'],
  func: async (page, args) => {
    const id = requireId(args.id); const sourcePage = await gotoDetail(page, id, 'fans');
    const ready = await poll(page, async () => page.evaluate(`() => {
      const seen = new Set(); let analysis = null;
      for (const element of document.querySelectorAll('*')) {
        const vm = element.__vue__; if (!vm || seen.has(vm)) continue; seen.add(vm);
        if (vm.$options?.name === 'fans-analysis') analysis = vm;
      }
      return { ready: Boolean(analysis), portraitType: analysis?.portraitType ?? null };
    }`), (value) => value?.ready, 18);
    if (!ready?.ready) throw new EmptyResultError('chanmama audience', `id=${id}`);
    const payload = await page.evaluate(`async () => {
      const seen = new Set(); let analysis = null; let comments = null;
      for (const element of document.querySelectorAll('*')) {
        const vm = element.__vue__; if (!vm || seen.has(vm)) continue; seen.add(vm);
        if (vm.$options?.name === 'fans-analysis') analysis = vm;
        if (vm.$options?.name === 'fans-table') comments = {
          totalCount: vm.totalCount,
          productCount: vm.productCommentList?.length || 0,
          videoCount: vm.awemeCommentList?.length || 0,
          isAuth: vm.isAuth
        };
      }
      if (!analysis) return { ready: false };
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const hasProfile = (data) => Boolean(
        data?.purpose?.length || data?.gender?.length || data?.age?.length
        || data?.province?.length || data?.city?.length
      );
      const capture = async (portraitType, refName, scope) => {
        analysis.portraitType = portraitType;
        await analysis.$nextTick();
        let component = analysis.$refs?.[refName] || null;
        for (let index = 0; index < 20 && !component?.$data; index += 1) {
          await wait(100);
          component = analysis.$refs?.[refName] || null;
        }
        if (!component?.$data) return { scope, unavailable: true };
        if (typeof component.getData === 'function') await Promise.resolve(component.getData());
        for (let index = 0; index < 48; index += 1) {
          if (!component.isLoading && hasProfile(component.productData)) break;
          await wait(250);
        }
        return {
          scope,
          portraitData: component.productData,
          geographyData: component.productAreaData,
          preferenceData: portraitType === '1' ? component.awaTageData : null,
          groupData: portraitType === '2' ? component.consumerGroups : null,
          pending: component.isLoading,
          unavailable: !hasProfile(component.productData),
        };
      };
      const originalType = analysis.portraitType;
      const profiles = [
        await capture('1', 'fansInfo', 'product-audience'),
        await capture('2', 'ConcludeTransactionInfo', 'product-buyers'),
      ];
      analysis.portraitType = originalType;
      await analysis.$nextTick();
      return { ready: true, dateRange: analysis.dateRange, comments, profiles };
    }`);
    if (!payload?.ready) throw new EmptyResultError('chanmama audience', `id=${id}`);
    const profiles = (payload.profiles || []).filter(({ portraitData, unavailable, pending }) => (
      !unavailable && !pending && (
        portraitData?.purpose?.length || portraitData?.gender?.length || portraitData?.age?.length
        || portraitData?.province?.length || portraitData?.city?.length
      )
    ));
    if (!profiles.length) throw new EmptyResultError('chanmama audience', `id=${id}`);
    const observedAt = capturedAt();
    return profiles.map(({ scope, portraitData, geographyData, preferenceData, groupData }) => ({
      promotionId: id, profileType: scope, summary: portraitData.purpose || [],
      genderJson: JSON.stringify({ malePct: portraitData.gender?.[0] ?? null, femalePct: portraitData.gender?.[1] ?? null }),
      ageJson: JSON.stringify(portraitData.age || []), provinceJson: JSON.stringify(portraitData.province || []), cityJson: JSON.stringify(portraitData.city || []),
      contentPreferenceL1Json: JSON.stringify(preferenceData?.first || []),
      contentPreferenceL2Json: JSON.stringify(preferenceData?.second || []),
      windowStart: payload.dateRange?.[0] || null, windowEnd: payload.dateRange?.[1] || null,
      detailsJson: JSON.stringify({
        observedAt, sourcePage, profileScope: scope,
        areaData: geographyData || [], comments: payload.comments,
        consumerGroups: groupData || [],
        valueType: 'estimated', sourcePlatform: 'chanmama', evidenceGrade: 'B-third-party-estimate',
        marginalDistributionsOnly: true,
        jointDemographicsAvailable: false,
        contentPreferenceScope: preferenceData ? 'product-audience' : null,
        manualReviewRequired: ['profileSampleQuality', 'audienceBuyerComparison', 'platformAudienceCrossCheck'],
      }),
    }));
  },
});
