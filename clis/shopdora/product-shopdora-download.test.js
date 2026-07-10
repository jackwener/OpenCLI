import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

vi.mock('@jackwener/opencli/logger', () => ({
  log: {
    info: vi.fn(),
    status: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
    step: vi.fn(),
    stepResult: vi.fn(),
  },
}));

import './product-shopdora-download.js';

const {
  SHOPDORA_COMMENT_ANALYSIS_URL,
  SHOPDORA_API_CAPTURE_PATTERN,
  SHOPDORA_COMMENT_DETAIL_URL,
  SHOPDORA_COMMENT_LIST_API_URL,
  SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE,
  OUTPUT_COLUMNS,
  RESULT_TIMEOUT_SECONDS,
  DOWNLOAD_TIMEOUT_SECONDS,
  TASK_PROGRESS_REFRESH_INTERVAL_SECONDS,
  SHOPEE_REGION_OPTIONS,
  normalizeShopeeProductUrl,
  parseShopeeProductIdentifiers,
  deriveShopeeSiteFromUrl,
  getShopeeRegionOptionFromUrl,
  buildCommentDetailUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  buildEnsureCheckboxStateScript,
  buildReadRegionSelectValueScript,
  selectCommentAnalysisRegion,
  buildForceDomClickScript,
  buildIsCommentDetailVisibleScript,
  buildReadCommentSummaryUnavailableScript,
  assertCommentSummaryAvailable,
  buildReadRangeInputValuesScript,
  parseInterceptedPayload,
  readInterceptedEntryRequestBody,
  readInterceptedEntryRequestHeaders,
  makeShopdoraSign,
  readTaskProgress,
  isPluginQueryTaskEntry,
  extractCommentAnalysisRows,
  isCommentAnalysisPayload,
  readInterceptedEntryUrl,
  isCommentAnalysisEntry,
  extractCommentListRows,
  isShopdoraCommentListUrl,
  isCommentListEntry,
  summarizeInterceptedApiUrls,
  readCommentListPageInfo,
  pickBestCommentListEntry,
  findTaskKeyInPayload,
  mapCreatedTaskPayloadToTask,
  waitForLastCommentListRows,
  fetchRemainingCommentListRows,
  clickDownloadCommentAndWait,
  mapCommentAnalysisRowToTask,
  summarizeInterceptedEntryUrls,
  fetchCommentAnalysisRows,
  findExistingCommentAnalysisTask,
  waitForDirectCommentAnalysisTask,
  waitForCompletedCommentAnalysisTask,
  waitForPluginQueryTaskProgress,
  findMatchingCommentAnalysisTaskFromEntries,
  probeExistingCommentAnalysisTask,
  waitForExistingCommentAnalysisTask,
  selectMatchingCommentAnalysisRow,
  computeShiftedDateFromInputValue,
  setShiftedCommentTimeStartValue,
  runWithFocusedWindow,
  openShopdoraPage,
  openShopdoraPageWithInterceptor,
  refreshShopdoraPageDuringTaskWait,
  triggerCommentAnalysisQuery,
  refreshCommentAnalysisPageUnderInterceptor,
  openCommentDetailTabIfPresent,
  waitForTaskKey,
} = await import('./product-shopdora-download.js').then((m) => m.__test__);

describe('shopdora product-shopdora-download adapter', () => {
  const command = getRegistry().get('shopdora/product-shopdora-download');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('shopdora');
    expect(command.name).toBe('product-shopdora-download');
    expect(command.domain).toBe('www.shopdora.com');
    expect(command.strategy).toBe('cookie');
    expect(command.navigateBefore).toBe(false);
    expect(command.timeoutSeconds).toBe(DOWNLOAD_TIMEOUT_SECONDS);
    expect(RESULT_TIMEOUT_SECONDS).toBe(600);
    expect(TASK_PROGRESS_REFRESH_INTERVAL_SECONDS).toBe(120);
    expect(command.columns).toEqual(OUTPUT_COLUMNS);
    expect(typeof command.func).toBe('function');
  });

  it('has shopeeProductUrl as a required positional arg', () => {
    const arg = command.args.find((item) => item.name === 'shopeeProductUrl');
    expect(arg).toBeDefined();
    expect(arg.required).toBe(true);
    expect(arg.positional).toBe(true);
  });

  it('normalizes and parses shopee product urls', () => {
    expect(normalizeShopeeProductUrl('https://shopee.sg/abc-i.902829235.21166583642')).toBe('https://shopee.sg/abc-i.902829235.21166583642');
    expect(() => normalizeShopeeProductUrl('')).toThrow('A Shopee product URL is required.');
    expect(() => normalizeShopeeProductUrl('https://example.com/item')).toThrow('shopdora product-shopdora-download only supports Shopee product URLs.');
    expect(parseShopeeProductIdentifiers('https://shopee.sg/abc-i.902829235.21166583642')).toEqual({
      shopId: '902829235',
      itemId: '21166583642',
    });
    expect(parseShopeeProductIdentifiers('https://shopee.sg/Cuties-Heavy-Duty-Compact-Toilet-Roll-3-Ply-(3x10rolls)-i.91799978.2163522340')).toEqual({
      shopId: '91799978',
      itemId: '2163522340',
    });
    expect(parseShopeeProductIdentifiers('https://shopee.sg/product/91799978/2163522340')).toEqual({
      shopId: '91799978',
      itemId: '2163522340',
    });
    expect(parseShopeeProductIdentifiers('https://shopee.sg/product/91799978/2163522340?sp_atk=abc#reviews')).toEqual({
      shopId: '91799978',
      itemId: '2163522340',
    });
    expect(deriveShopeeSiteFromUrl('https://shopee.sg/abc-i.902829235.21166583642')).toBe('sg');
    expect(SHOPEE_REGION_OPTIONS.map((option) => option.title)).toContain('新加坡');
    expect(getShopeeRegionOptionFromUrl('https://shopee.com.my/abc-i.1.2')).toMatchObject({
      site: 'my',
      title: '马来西亚',
    });
    expect(getShopeeRegionOptionFromUrl('https://sg.xiapibuy.com/abc-i.1.2')).toMatchObject({
      site: 'sg',
      title: '新加坡',
    });
    expect(buildCommentDetailUrl({
      site: 'sg',
      taskKey: 'abc',
      shopId: '902829235',
    })).toBe(`${SHOPDORA_COMMENT_DETAIL_URL}?site=sg&taskKey=abc&shopId=902829235`);
  });

  it('builds selector and input scripts around the dialog workflow', () => {
    expect(buildResolveTargetSelectorScript('add-button')).toContain('添加产品');
    expect(buildResolveTargetSelectorScript('add-button')).toContain('.t-icon-add');
    expect(buildResolveTargetSelectorScript('product-link-input')).toContain('产品链接');
    expect(buildResolveTargetSelectorScript('comment-analysis-keyword-input')).toContain('产品名/id/关键字');
    expect(buildResolveTargetSelectorScript('query-button')).toContain('查询');
    expect(buildResolveTargetSelectorScript('region-select-trigger')).toContain('新加坡');
    expect(buildResolveTargetSelectorScript('region-option:马来西亚')).toContain('region-option:');
    expect(buildResolveTargetSelectorScript('region-option:马来西亚')).toContain('.t-select-option');
    expect(buildReadRegionSelectValueScript('[data-test="region"]')).toContain('region_select_not_found');
    expect(buildResolveTargetSelectorScript('confirm-button')).toContain('确定');
    expect(buildResolveTargetSelectorScript('comment-detail-tab')).toContain('评论详情');
    expect(buildResolveTargetSelectorScript('comment-detail-tab')).toContain('.t-tabs__nav-item-text-wrapper');
    expect(buildResolveTargetSelectorScript('download-comment-button')).toContain('下载评论');
    expect(buildResolveTargetSelectorScript('download-comment-button')).toContain('.item-btn .t-button__text');
    expect(buildResolveTargetSelectorScript('download-comment-button')).toContain('.t-button__text');
    expect(buildResolveTargetSelectorScript('rating-4-input')).toContain('"rating-4-input":"4"');
    expect(buildResolveTargetSelectorScript('rating-4-input')).toContain('t-checkbox__former');
    expect(buildResolveTargetSelectorScript('media-checkbox-input')).toContain('"media-checkbox-input":"1"');
    expect(buildResolveTargetSelectorScript('empty-comment-checkbox-input')).toContain('"empty-comment-checkbox-input":"2"');
    expect(buildEnsureCheckboxStateScript('[data-test="checkbox"]', true)).toContain('toggle_target_not_found');
    expect(buildForceDomClickScript('[data-test="tab"]')).toContain('pointerdown');
    expect(buildIsCommentDetailVisibleScript()).toContain('.comment-detail');
    expect(buildReadCommentSummaryUnavailableScript()).toContain(SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE);
    expect(buildReadCommentSummaryUnavailableScript()).toContain('/my/analysis/newComment');
    expect(buildReadRangeInputValuesScript('[data-test="input"]')).toContain('endValue');
    expect(buildSetInputValueScript('[data-test="input"]', 'https://shopee.sg/item')).toContain('dispatchEvent(new Event(\'input\'');
  });

  it('resolves the current Shopdora add-product button structure', () => {
    const dom = new JSDOM(`
      <div class="inline-filter-containter">
        <form class="t-form t-form-inline">
          <button class="t-button t-button--theme-primary confirm" type="button">
            <span class="t-button__text">查询</span>
          </button>
          <button class="t-button t-button--theme-default reset" type="button">
            <span class="t-button__text">重置</span>
          </button>
          <button class="t-button t-button--theme-primary add" type="button">
            <svg class="t-icon t-icon-add"></svg>
            <span class="t-button__text"> 添加产品</span>
          </button>
        </form>
      </div>
    `, { runScripts: 'outside-only' });

    Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32 }),
    });

    const result = dom.window.eval(buildResolveTargetSelectorScript('add-button'));

    expect(result).toMatchObject({
      ok: true,
      selector: '[data-opencli-shopdora-product-shopdora-download-target="add-button"]',
    });
    expect(dom.window.document.querySelector(result.selector)?.classList.contains('add')).toBe(true);
  });

  it('resolves region options from popup list items with decorated text', () => {
    const dom = new JSDOM(`
      <div class="t-popup">
        <ul>
          <li class="shopdora-region-option"><span>马来西亚 MY</span></li>
        </ul>
      </div>
    `, { runScripts: 'outside-only' });

    Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32 }),
    });

    const result = dom.window.eval(buildResolveTargetSelectorScript('region-option:马来西亚'));

    expect(result).toMatchObject({
      ok: true,
      selector: '[data-opencli-shopdora-product-shopdora-download-target="region-option:马来西亚"]',
    });
    expect(dom.window.document.querySelector(result.selector)?.tagName).toBe('LI');
  });

  it('parses intercepted payloads, adjusts the date, and picks the matching analysis row', () => {
    const queryTask = { code: 'ok', data: { progress: 100 } };
    const commentAnalysis = {
      code: 'ok',
      data: {
        list: [
          { taskKey: 'other-task', itemId: '18892247931', shopId: '282945261', site: 'sg', progress: 100, createTime: '20260506150328' },
          { taskKey: 'wanted-task', itemId: '21166583642', shopId: '902829235', site: 'sg', progress: 100, createTime: '20260506170410' },
        ],
      },
    };

    expect(parseInterceptedPayload({ body: JSON.stringify(queryTask) })).toEqual(queryTask);
    expect(readInterceptedEntryUrl({ url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1' })).toContain('/api/comment/commentAnalysis');
    expect(isCommentAnalysisEntry({ url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1' })).toBe(true);
    expect(isCommentAnalysisPayload(commentAnalysis)).toBe(true);
    expect(isCommentAnalysisEntry({ body: JSON.stringify(commentAnalysis) })).toBe(true);
    expect(extractCommentListRows({ code: 'ok', data: { list: [{ commentId: 'c1' }] } })).toEqual([{ commentId: 'c1' }]);
    expect(isShopdoraCommentListUrl(`${SHOPDORA_COMMENT_LIST_API_URL}?page=1`)).toBe(true);
    expect(isShopdoraCommentListUrl('/api/comment/list?page=1')).toBe(true);
    expect(isShopdoraCommentListUrl('https://example.com/api/comment/list?page=1')).toBe(false);
    expect(isCommentListEntry({
      url: `${SHOPDORA_COMMENT_LIST_API_URL}?page=1`,
      requestBody: JSON.stringify({ itemId: 8702793782, pageNum: 1 }),
      requestHeaders: { 'Shopdora-Token': 'token-1', Endpoint: 'pc' },
      body: JSON.stringify({ code: 'ok', data: { list: [{ commentId: 'c1' }] } }),
    })).toBe(true);
    expect(readInterceptedEntryRequestBody({
      requestBody: JSON.stringify({ itemId: 8702793782, pageNum: 1 }),
    })).toEqual({ itemId: 8702793782, pageNum: 1 });
    expect(readInterceptedEntryRequestHeaders({
      requestHeaders: { 'Shopdora-Token': 'token-1', Endpoint: 'pc' },
    })).toEqual({ 'shopdora-token': 'token-1', endpoint: 'pc' });
    expect(readCommentListPageInfo({
      code: 'ok',
      data: { list: [], totalCount: 75, totalPage: 2, currentPage: 1 },
    })).toEqual({ totalCount: 75, totalPage: 2, currentPage: 1 });
    expect(pickBestCommentListEntry([
      {
        url: `${SHOPDORA_COMMENT_LIST_API_URL}?page=1`,
        body: JSON.stringify({ code: 'ok', data: { list: [{ commentId: 'without-body' }] } }),
      },
      {
        url: `${SHOPDORA_COMMENT_LIST_API_URL}?page=1`,
        requestBody: JSON.stringify({ itemId: 8702793782, pageNum: 1, pageSize: 50 }),
        body: JSON.stringify({ code: 'ok', data: { list: [{ commentId: 'with-body' }] } }),
      },
    ])).toMatchObject({ requestBody: JSON.stringify({ itemId: 8702793782, pageNum: 1, pageSize: 50 }) });
    expect(makeShopdoraSign({
      itemId: 8702793782,
      shopId: '236813629',
      site: 'sg',
      star: [5, 1],
      startTime: '1770422400',
      endTime: '1778112000',
      keyword: '',
      commentType: [0, 1],
      pageNum: 2,
      pageSize: 50,
      downloadCount: -1,
      isTranslate: false,
    }, '1778147057137')).toBe('D27F717A7B3509C16EA9EBF7964E2F12');
    expect(summarizeInterceptedApiUrls([
      { url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1' },
      { url: `${SHOPDORA_COMMENT_LIST_API_URL}?page=1` },
      { url: 'https://www.shopdora.com/assets/app.js' },
    ])).toBe(`https://www.shopdora.com/api/comment/commentAnalysis?page=1, ${SHOPDORA_COMMENT_LIST_API_URL}?page=1`);
    expect(summarizeInterceptedEntryUrls([{ url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1' }])).toContain('/api/comment/commentAnalysis');
    expect(readTaskProgress(queryTask)).toBe(100);
    expect(isPluginQueryTaskEntry({
      url: 'https://www.shopdora.com/api/plugin/queryTask',
      body: JSON.stringify(queryTask),
    })).toBe(true);
    expect(extractCommentAnalysisRows(commentAnalysis)).toHaveLength(2);
    expect(computeShiftedDateFromInputValue('2026-05-06')).toBe('2026-02-06');
    expect(selectMatchingCommentAnalysisRow(commentAnalysis.data.list, {
      itemId: '21166583642',
      shopId: '902829235',
    })).toMatchObject({ taskKey: 'wanted-task', site: 'sg' });
    expect(selectMatchingCommentAnalysisRow(commentAnalysis.data.list, {
      itemId: '15486104239',
      shopId: '783589115',
      site: 'sg',
    })).toBeNull();
    expect(mapCommentAnalysisRowToTask(commentAnalysis.data.list[1], {
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
    })).toMatchObject({ taskKey: 'wanted-task', progress: 100 });
    expect(findTaskKeyInPayload({ code: 'ok', data: { taskKey: 'created-task' } })).toBe('created-task');
    expect(mapCreatedTaskPayloadToTask({ code: 'ok', data: { taskKey: 'created-task' } }, {
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
    })).toEqual({
      taskKey: 'created-task',
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
      progress: 0,
    });
    expect(findMatchingCommentAnalysisTaskFromEntries([{
      url: 'https://www.shopdora.com/api/comment/commentAnalysis',
      body: JSON.stringify(commentAnalysis),
    }], {
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
    })).toMatchObject({ taskKey: 'wanted-task', progress: 100 });
  });

  it('fetches remaining comment/list pages when totalCount exceeds api totalPage', async () => {
    const firstRows = Array.from({ length: 50 }, (_, index) => ({ cmtid: `page-1-${index}` }));
    const secondRows = Array.from({ length: 43 }, (_, index) => ({ cmtid: `page-2-${index}` }));
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      expect(source).toContain('\\"pageNum\\":2');
      return {
        ok: true,
        status: 200,
        json: {
          code: 'ok',
          data: {
            list: secondRows,
            currentPage: 2,
            totalPage: 1,
            totalCount: 93,
          },
        },
        text: '',
      };
    });

    const rows = await fetchRemainingCommentListRows({ evaluate }, {
      rows: firstRows,
      payload: {
        code: 'ok',
        data: {
          list: firstRows,
          currentPage: 1,
          totalPage: 1,
          totalCount: 93,
        },
      },
      entry: {
        requestBody: JSON.stringify({
          itemId: 8702793782,
          shopId: '236813629',
          site: 'sg',
          pageNum: 1,
          pageSize: 50,
        }),
        requestHeaders: { 'shopdora-token': 'token-1' },
      },
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(93);
    expect(rows.at(-1)).toEqual({ cmtid: 'page-2-42' });
  });

  it('reuses an existing commentAnalysis task when the intercepted list already contains the itemId', async () => {
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: {
            list: [
              {
                taskKey: 'a9d3-task',
                itemId: '27658353502',
                shopId: '1273178276',
                site: 'sg',
                progress: 100,
              },
            ],
          },
        }),
      }]);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(waitForExistingCommentAnalysisTask({
      getInterceptedRequests,
      wait,
    }, {
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
    }, 1)).resolves.toMatchObject({
      taskKey: 'a9d3-task',
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
      progress: 100,
    });
  });

  it('reports whether any intercepted commentAnalysis response was actually seen', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(probeExistingCommentAnalysisTask({
      getInterceptedRequests: vi.fn().mockResolvedValue([]),
      wait,
    }, {
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
    }, 1)).resolves.toEqual({
      task: null,
      sawCommentAnalysisResponse: false,
    });

    await expect(probeExistingCommentAnalysisTask({
      getInterceptedRequests: vi.fn().mockResolvedValue([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: '',
      }]),
      wait,
    }, {
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
    }, 1)).resolves.toEqual({
      task: null,
      sawCommentAnalysisResponse: true,
    });
  });

  it('reuses an existing commentAnalysis task from a direct fetch when the item already exists', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: {
        code: 'ok',
        data: {
          list: [
            {
              taskKey: 'a9d3-task',
              itemId: '27658353502',
              shopId: '1273178276',
              site: 'sg',
              progress: 100,
            },
          ],
        },
      },
      text: '',
    });

    await expect(fetchCommentAnalysisRows({ evaluate })).resolves.toHaveLength(1);
    await expect(findExistingCommentAnalysisTask({ evaluate }, {
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
    })).resolves.toMatchObject({
      taskKey: 'a9d3-task',
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
      progress: 100,
    });
  });

  it('waits for direct commentAnalysis fetch to populate when the first response is still empty', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { code: 'ok', data: { list: [] } },
        text: '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: {
          code: 'ok',
          data: {
            list: [
              {
                taskKey: 'late-task',
                itemId: '27658353502',
                shopId: '1273178276',
                site: 'sg',
                progress: 100,
              },
            ],
          },
        },
        text: '',
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(waitForDirectCommentAnalysisTask({ evaluate, wait }, {
      itemId: '27658353502',
      shopId: '1273178276',
      site: 'sg',
    }, 1)).resolves.toMatchObject({
      task: {
        taskKey: 'late-task',
        itemId: '27658353502',
        shopId: '1273178276',
        site: 'sg',
        progress: 100,
      },
    });
  });

  it('clicks the comment-detail tab when the selector is present', async () => {
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-detail-tab";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-detail-tab"]' };
      }
      if (source.includes('pointerdown')) {
        return { ok: true };
      }
      return { ok: false, error: 'target_not_found' };
    });

    await expect(openCommentDetailTabIfPresent({ evaluate })).resolves.toBe(true);
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('const target = "comment-detail-tab";')),
    ).toBe(true);
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('pointerdown')),
    ).toBe(true);
  });

  it('treats the comment-detail tab as already open when the detail pane is visible but selector is absent', async () => {
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-detail-tab";')) {
        return { ok: false, error: 'target_not_found' };
      }
      if (source.includes('.comment-detail')) {
        return { ok: true, visiblePanel: true, activeTabText: '评论详情' };
      }
      return { ok: false, error: 'target_not_found' };
    });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(openCommentDetailTabIfPresent({ evaluate, wait })).resolves.toBe(true);
  });

  it('treats the comment-detail tab as optional when neither visible panel nor tab target exists', async () => {
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-detail-tab";')) {
        return { ok: false, error: 'target_not_found' };
      }
      if (source.includes('.comment-detail')) {
        return { ok: true, visiblePanel: false, activeTabText: '' };
      }
      return { ok: false, error: 'target_not_found' };
    });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(openCommentDetailTabIfPresent({ evaluate, wait })).resolves.toBe(false);
  });

  it('throws a clear error when newComment reports too few cumulative comments', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      ok: true,
      isNewCommentPage: true,
      hasMessage: true,
      message: SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE,
    });

    await expect(assertCommentSummaryAvailable({ evaluate })).rejects.toThrow(SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE);
  });

  it('falls back to current-tab navigation when newTab is unavailable', async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    await expect(openShopdoraPage({ goto }, SHOPDORA_COMMENT_ANALYSIS_URL)).resolves.toEqual({
      tabId: null,
      currentUrl: SHOPDORA_COMMENT_ANALYSIS_URL,
      navigationMode: 'goto',
    });
    expect(goto).toHaveBeenCalledWith(SHOPDORA_COMMENT_ANALYSIS_URL, { waitUntil: 'load' });
  });

  it('opens the target page first, then installs the interceptor on the loaded page', async () => {
    const newTab = vi.fn().mockResolvedValue('page-comment-analysis');
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const getCurrentUrl = vi.fn().mockResolvedValue(SHOPDORA_COMMENT_ANALYSIS_URL);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(openShopdoraPageWithInterceptor({
      newTab,
      selectTab,
      installInterceptor,
      getCurrentUrl,
      wait,
    }, SHOPDORA_COMMENT_ANALYSIS_URL, SHOPDORA_API_CAPTURE_PATTERN)).resolves.toEqual({
      tabId: 'page-comment-analysis',
      currentUrl: SHOPDORA_COMMENT_ANALYSIS_URL,
      navigationMode: 'newTab',
    });

    expect(newTab).toHaveBeenCalledWith(SHOPDORA_COMMENT_ANALYSIS_URL);
    expect(selectTab).toHaveBeenCalledWith('page-comment-analysis');
    expect(installInterceptor).toHaveBeenCalledWith(SHOPDORA_API_CAPTURE_PATTERN);
  });

  it('clicks the query button to trigger the commentAnalysis request', async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waitForCapture = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-analysis-keyword-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-analysis-keyword-input"]' };
      }
      if (source.includes('const target = "query-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="query-button"]' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: '27658353502' };
      }
      return { ok: false, error: 'target_not_found' };
    });

    await expect(triggerCommentAnalysisQuery({
      __opencliShopdoraExpectedItemId: '27658353502',
      click,
      wait,
      evaluate,
      waitForCapture,
    })).resolves.toBeUndefined();

    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('const target = "comment-analysis-keyword-input";')),
    ).toBe(true);
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="query-button"]');
    expect(waitForCapture).toHaveBeenCalledWith(5);
  });

  it('selects the comment analysis region before querying when a region is known', async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "region-select-trigger";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]' };
      }
      if (source.includes('region_select_not_found')) {
        return { ok: true, value: '台湾' };
      }
      if (source.includes('const target = "region-option:马来西亚";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-option:马来西亚"]' };
      }
      return { ok: false, error: 'target_not_found' };
    });

    await expect(selectCommentAnalysisRegion({
      click,
      wait,
      evaluate,
    }, '马来西亚')).resolves.toBe(true);

    expect(click).toHaveBeenNthCalledWith(
      1,
      '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]',
    );
    expect(click).toHaveBeenNthCalledWith(
      2,
      '[data-opencli-shopdora-product-shopdora-download-target="region-option:马来西亚"]',
    );
  });

  it('falls back to a DOM click when the region select bridge click fails', async () => {
    const click = vi.fn().mockImplementation(async (selector) => {
      if (selector === '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]') {
        throw new Error('element click intercepted');
      }
    });
    const wait = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "region-select-trigger";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]' };
      }
      if (source.includes('region_select_not_found')) {
        return { ok: true, value: '台湾' };
      }
      if (source.includes('pointerdown')) {
        return { ok: true, tag: 'div', className: 't-select', text: '台湾' };
      }
      if (source.includes('const target = "region-option:马来西亚";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-option:马来西亚"]' };
      }
      return { ok: false, error: 'target_not_found' };
    });

    await expect(selectCommentAnalysisRegion({
      click,
      wait,
      evaluate,
    }, '马来西亚')).resolves.toBe(true);

    expect(click).toHaveBeenNthCalledWith(
      1,
      '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]',
    );
    expect(click).toHaveBeenNthCalledWith(
      2,
      '[data-opencli-shopdora-product-shopdora-download-target="region-option:马来西亚"]',
    );
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('pointerdown')),
    ).toBe(true);
  });

  it('retries the query button under the active interceptor', async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waitForCapture = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-analysis-keyword-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-analysis-keyword-input"]' };
      }
      if (source.includes('const target = "query-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="query-button"]' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: '27658353502' };
      }
      return { ok: false, error: 'target_not_found' };
    });

    await expect(refreshCommentAnalysisPageUnderInterceptor({
      __opencliShopdoraExpectedItemId: '27658353502',
      click,
      wait,
      evaluate,
      waitForCapture,
    })).resolves.toBeUndefined();

    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="query-button"]');
    expect(waitForCapture).toHaveBeenCalledWith(5);
  });

  it('temporarily forces focused automation windows for newTab flows', async () => {
    delete process.env.OPENCLI_WINDOW_FOCUSED;
    await expect(runWithFocusedWindow(async () => {
      expect(process.env.OPENCLI_WINDOW_FOCUSED).toBe('1');
      return 'ok';
    })).resolves.toBe('ok');
    expect(process.env.OPENCLI_WINDOW_FOCUSED).toBeUndefined();
  });

  it('waits for progress=100 and then returns the matching taskKey', async () => {
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([{ code: 'ok', data: { progress: 20 } }])
      .mockResolvedValueOnce([{ code: 'ok', data: { progress: 100 } }])
      .mockResolvedValueOnce([{
        code: 'ok',
        data: {
          list: [
            {
              taskKey: 'ff45e76aa0132d79d425f19d64b020ae18a47b524a0196dd74f16bb08abb1466',
              itemId: '21166583642',
              shopId: '902829235',
              site: 'sg',
              progress: 100,
              createTime: '20260506170410',
            },
          ],
        },
      }]);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await waitForTaskKey({
      getInterceptedRequests,
      wait,
    }, {
      itemId: '21166583642',
      shopId: '902829235',
    }, 5);

    expect(result).toEqual({
      taskKey: 'ff45e76aa0132d79d425f19d64b020ae18a47b524a0196dd74f16bb08abb1466',
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
      progress: 100,
    });
    expect(wait).toHaveBeenCalled();
  });

  it('returns the created taskKey immediately even before progress reaches 100', async () => {
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: {
            list: [
              {
                taskKey: 'created-but-running-task',
                itemId: '21166583642',
                shopId: '902829235',
                site: 'sg',
                progress: 20,
                createTime: '20260506170410',
              },
            ],
          },
        }),
      }]);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await waitForTaskKey({
      getInterceptedRequests,
      wait,
    }, {
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
    }, 5);

    expect(result).toEqual({
      taskKey: 'created-but-running-task',
      itemId: '21166583642',
      shopId: '902829235',
      site: 'sg',
      progress: 20,
    });
    expect(getInterceptedRequests).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('refreshes the Shopdora page while waiting for queryTask progress', async () => {
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1000;
      return now;
    });
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([{ code: 'ok', data: { progress: 20 } }])
      .mockResolvedValueOnce([{ code: 'ok', data: { progress: 100 } }]);
    const goto = vi.fn().mockResolvedValue(undefined);
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue({ ok: true, alreadyInstalled: false });
    const getCurrentUrl = vi.fn().mockResolvedValue(`${SHOPDORA_COMMENT_DETAIL_URL}?site=sg&taskKey=task-1&shopId=1`);

    try {
      const result = await waitForPluginQueryTaskProgress({
        getInterceptedRequests,
        getCurrentUrl,
        goto,
        installInterceptor,
        evaluate,
        wait,
      }, {
        taskKey: 'task-1',
        itemId: '2',
        shopId: '1',
        site: 'sg',
        progress: 20,
      }, 5, {
        refreshIntervalSeconds: 0.5,
      });

      expect(result).toMatchObject({ taskKey: 'task-1', progress: 100 });
      expect(goto).toHaveBeenCalledWith(`${SHOPDORA_COMMENT_DETAIL_URL}?site=sg&taskKey=task-1&shopId=1`, { waitUntil: 'load' });
      expect(installInterceptor).toHaveBeenCalledWith(SHOPDORA_API_CAPTURE_PATTERN);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('takes taskKey only from commentAnalysis responses and ignores unrelated task-like payloads', async () => {
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([
        { code: 'ok', data: { progress: 100 } },
        {
          url: 'https://www.shopdora.com/api/comment/addProduct',
          body: JSON.stringify({
            code: 'ok',
            data: {
              list: [
                {
                  taskKey: 1,
                  itemId: '15486104239',
                  shopId: '783589115',
                  site: 'sg',
                  progress: 100,
                },
              ],
            },
          }),
        },
      ])
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: {
            list: [
              {
                taskKey: 'real-comment-analysis-task',
                itemId: '15486104239',
                shopId: '783589115',
                site: 'sg',
                progress: 100,
                createTime: '20260507010000',
              },
            ],
          },
        }),
      }]);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await waitForTaskKey({
      getInterceptedRequests,
      wait,
    }, {
      itemId: '15486104239',
      shopId: '783589115',
      site: 'sg',
    }, 5);

    expect(result).toEqual({
      taskKey: 'real-comment-analysis-task',
      itemId: '15486104239',
      shopId: '783589115',
      site: 'sg',
      progress: 100,
    });
  });

  it('clicks the date input, shifts it back three months, and presses Enter', async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const pressKey = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('const target = "comment-time-start-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-time-start-input"]' };
      }
      if (source.includes('startValue:') && source.includes('endValue:')) {
        return { ok: true, startValue: '2026-04-06', endValue: '2026-05-06' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: '2026-02-06' };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      return { ok: true };
    });

    await expect(setShiftedCommentTimeStartValue({
      click,
      wait,
      evaluate,
      pressKey,
    })).resolves.toBe('2026-02-06');

    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="comment-time-start-input"]');
    expect(pressKey).toHaveBeenCalledWith('Enter');
  });

  it('navigates, submits the task, configures filters, clicks download comments, and returns the downloaded file URL', async () => {
    const downloadedFile = '/tmp/opencli-shopdora-comments/comments.csv';
    const goto = vi.fn().mockResolvedValue(undefined);
    const newTab = vi.fn()
      .mockResolvedValueOnce('page-comment-analysis')
      .mockResolvedValueOnce('page-comment-detail');
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const pressKey = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "comment-analysis-keyword-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-analysis-keyword-input"]' };
      }
      if (source.includes('const target = "query-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="query-button"]' };
      }
      if (source.includes('const target = "region-select-trigger";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]' };
      }
      if (source.includes('region_select_not_found')) {
        return { ok: true, value: '新加坡' };
      }
      if (source.includes('const target = "region-option:新加坡";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-option:新加坡"]' };
      }
      if (source.includes('const target = "add-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="add-button"]' };
      }
      if (source.includes('const target = "product-link-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="product-link-input"]' };
      }
      if (source.includes('const target = "submit-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="submit-button"]' };
      }
      if (source.includes('const target = "confirm-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="confirm-button"]' };
      }
      if (source.includes('const target = "comment-detail-tab";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-detail-tab"]' };
      }
      if (source.includes('const target = "comment-time-start-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-time-start-input"]' };
      }
      if (source.includes('const target = "rating-4-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-4-input"]' };
      }
      if (source.includes('const target = "rating-3-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-3-input"]' };
      }
      if (source.includes('const target = "rating-2-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-2-input"]' };
      }
      if (source.includes('const target = "rating-1-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-1-input"]' };
      }
      if (source.includes('const target = "media-checkbox-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="media-checkbox-input"]' };
      }
      if (source.includes('const target = "download-comment-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]' };
      }
      if (source.includes('const target = "empty-comment-checkbox-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="empty-comment-checkbox-input"]' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        if (source.includes('2026-02-06')) {
          return { ok: true, value: '2026-02-06' };
        }
        return { ok: true, value: 'https://shopee.sg/abc-i.902829235.21166583642' };
      }
      if (source.includes('startValue:') && source.includes('endValue:')) {
        return { ok: true, startValue: '2026-04-06', endValue: '2026-05-06' };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      if (source.includes('toggle_target_not_found')) {
        return { ok: true, checked: true };
      }
      return { ok: true };
    });
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: { list: [] },
        }),
      }])
      .mockResolvedValueOnce([{ code: 'ok', data: { progress: 100 } }])
      .mockResolvedValueOnce([{
        code: 'ok',
        data: {
          list: [
            {
              taskKey: 'ff45e76aa0132d79d425f19d64b020ae18a47b524a0196dd74f16bb08abb1466',
              itemId: '21166583642',
              shopId: '902829235',
              site: 'sg',
              progress: 100,
              createTime: '20260506170410',
            },
          ],
        },
      }])
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: { list: [] },
        }),
      }])
      .mockResolvedValueOnce([{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: { list: [] },
        }),
      }]);
    const waitForDownload = vi.fn().mockResolvedValue({
      filename: downloadedFile,
      url: 'https://www.shopdora.com/api/comment/download',
      finalUrl: 'https://www.shopdora.com/api/comment/download',
      mime: 'text/csv',
      fileSize: 1234,
    });

    const page = {
      goto,
      newTab,
      selectTab,
      wait,
      evaluate,
      installInterceptor,
      click,
      pressKey,
      getInterceptedRequests,
      waitForDownload,
    };

    const result = await command.func(page, {
      shopeeProductUrl: 'https://shopee.sg/abc-i.902829235.21166583642',
    });

    expect(newTab).toHaveBeenNthCalledWith(1, SHOPDORA_COMMENT_ANALYSIS_URL);
    expect(newTab).toHaveBeenNthCalledWith(
      2,
      `${SHOPDORA_COMMENT_DETAIL_URL}?site=sg&taskKey=ff45e76aa0132d79d425f19d64b020ae18a47b524a0196dd74f16bb08abb1466&shopId=902829235`,
    );
    expect(selectTab).toHaveBeenNthCalledWith(1, 'page-comment-analysis');
    expect(selectTab).toHaveBeenNthCalledWith(2, 'page-comment-detail');
    expect(installInterceptor).toHaveBeenCalledWith(SHOPDORA_API_CAPTURE_PATTERN);
    expect(click).toHaveBeenNthCalledWith(1, '[data-opencli-shopdora-product-shopdora-download-target="query-button"]');
    expect(click).toHaveBeenNthCalledWith(2, '[data-opencli-shopdora-product-shopdora-download-target="add-button"]');
    expect(click).toHaveBeenNthCalledWith(3, '[data-opencli-shopdora-product-shopdora-download-target="submit-button"]');
    expect(click).toHaveBeenNthCalledWith(4, '[data-opencli-shopdora-product-shopdora-download-target="confirm-button"]');
    expect(click).not.toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]');
    expect(click).not.toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="region-option:新加坡"]');
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]');
    expect(waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 1800000,
    });
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('const target = "comment-detail-tab";')),
    ).toBe(true);
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('pointerdown')),
    ).toBe(true);
    const dateTargetCallIndex = evaluate.mock.calls.findIndex(([script]) => (
      String(script ?? '').includes('const target = "comment-time-start-input";')
    ));
    const ratingTargetCallIndex = evaluate.mock.calls.findIndex(([script]) => (
      String(script ?? '').includes('const target = "rating-4-input";')
    ));
    expect(dateTargetCallIndex).toBeGreaterThanOrEqual(0);
    expect(ratingTargetCallIndex).toBeGreaterThan(dateTargetCallIndex);
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('const target = "empty-comment-checkbox-input";')),
    ).toBe(false);
    expect(result).toEqual([{
      status: 'success',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      download_url: 'https://www.shopdora.com/api/comment/download',
      export_request_url: '',
      export_request_body: '',
      filename: downloadedFile,
      source_url: 'https://www.shopdora.com/api/comment/download',
      product_url: 'https://shopee.sg/abc-i.902829235.21166583642',
      taskKey: 'ff45e76aa0132d79d425f19d64b020ae18a47b524a0196dd74f16bb08abb1466',
      site: 'sg',
      shopId: '902829235',
      itemId: '21166583642',
      mime: 'text/csv',
      fileSize: 1234,
    }]);
  });

  it('returns an error when the newComment page says the product has fewer than 50 comments', async () => {
    const newTab = vi.fn()
      .mockResolvedValueOnce('page-comment-analysis')
      .mockResolvedValueOnce('page-comment-detail');
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForDownload = vi.fn().mockResolvedValue({
      filename: '/tmp/should-not-download.csv',
    });
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "comment-analysis-keyword-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-analysis-keyword-input"]' };
      }
      if (source.includes('const target = "query-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="query-button"]' };
      }
      if (source.includes('const target = "region-select-trigger";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]' };
      }
      if (source.includes('region_select_not_found')) {
        return { ok: true, value: '新加坡' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: '21166583642' };
      }
      if (source.includes(SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE)) {
        return {
          ok: true,
          isNewCommentPage: true,
          hasMessage: true,
          message: SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE,
        };
      }
      return { ok: true };
    });
    const getInterceptedRequests = vi.fn().mockResolvedValue([{
      url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
      body: JSON.stringify({
        code: 'ok',
        data: {
          list: [{
            taskKey: 'too-few-comments-task',
            itemId: '21166583642',
            shopId: '902829235',
            site: 'sg',
            progress: 100,
          }],
        },
      }),
    }]);

    const page = {
      newTab,
      selectTab,
      wait,
      evaluate,
      installInterceptor,
      click,
      getInterceptedRequests,
      waitForDownload,
    };

    await expect(command.func(page, {
      shopeeProductUrl: 'https://shopee.sg/abc-i.902829235.21166583642',
    })).rejects.toThrow(SHOPDORA_INSUFFICIENT_COMMENT_SUMMARY_MESSAGE);

    expect(newTab).toHaveBeenNthCalledWith(
      2,
      `${SHOPDORA_COMMENT_DETAIL_URL}?site=sg&taskKey=too-few-comments-task&shopId=902829235`,
    );
    expect(waitForDownload).not.toHaveBeenCalled();
  });

  it('refreshes under the interceptor and reuses the existing task when the first capture misses commentAnalysis', async () => {
    const downloadedFile = '/tmp/opencli-shopdora-comments/reused-comments.csv';
    const newTab = vi.fn()
      .mockResolvedValueOnce('page-comment-analysis')
      .mockResolvedValueOnce('page-comment-detail');
    let queryClickCount = 0;
    const goto = vi.fn().mockResolvedValue(undefined);
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const waitForCapture = vi.fn().mockResolvedValue(undefined);
    const pressKey = vi.fn().mockResolvedValue(undefined);
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    let commentListRequestReady = false;
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "comment-analysis-keyword-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-analysis-keyword-input"]' };
      }
      if (source.includes('const target = "query-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="query-button"]' };
      }
      if (source.includes('const target = "region-select-trigger";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-select-trigger"]' };
      }
      if (source.includes('region_select_not_found')) {
        return { ok: true, value: '新加坡' };
      }
      if (source.includes('const target = "region-option:新加坡";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="region-option:新加坡"]' };
      }
      if (source.includes('https://www.shopdora.com/api/comment/commentAnalysis')) {
        return {
          ok: true,
          status: 200,
          json: { code: 'ok', data: { list: [] } },
          text: '',
        };
      }
      if (source.includes('const target = "comment-detail-tab";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-detail-tab"]' };
      }
      if (source.includes('const target = "comment-time-start-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="comment-time-start-input"]' };
      }
      if (source.includes('const target = "rating-4-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-4-input"]' };
      }
      if (source.includes('const target = "rating-3-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-3-input"]' };
      }
      if (source.includes('const target = "rating-2-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-2-input"]' };
      }
      if (source.includes('const target = "rating-1-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="rating-1-input"]' };
      }
      if (source.includes('const target = "media-checkbox-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="media-checkbox-input"]' };
      }
      if (source.includes('const target = "download-comment-button";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]' };
      }
      if (source.includes('const target = "empty-comment-checkbox-input";')) {
        return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="empty-comment-checkbox-input"]' };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: '2026-02-06' };
      }
      if (source.includes('startValue:') && source.includes('endValue:')) {
        return { ok: true, startValue: '2026-04-06', endValue: '2026-05-06' };
      }
      if (source.includes("new KeyboardEvent('keydown'")) {
        return { ok: true };
      }
      if (source.includes('toggle_target_not_found')) {
        commentListRequestReady = true;
        return { ok: true, checked: true };
      }
      if (source.includes('pointerdown')) {
        return { ok: true };
      }
      return { ok: true };
    });
    const getInterceptedRequests = vi.fn().mockImplementation(async () => {
      if (queryClickCount < 2) {
        return [];
      }
      const entries = [{
        url: 'https://www.shopdora.com/api/comment/commentAnalysis?page=1',
        body: JSON.stringify({
          code: 'ok',
          data: {
            list: [
              {
                taskKey: 'a9d3a6556bbabf099744966eeea0c5bc48b4e159663314b8e5f3cefca630778d',
                itemId: '27658353502',
                shopId: '1273178276',
                site: 'sg',
                progress: 100,
              },
            ],
          },
        }),
      }];
      return entries;
    });
    const waitForDownload = vi.fn().mockResolvedValue({
      filename: downloadedFile,
      url: 'https://www.shopdora.com/api/comment/download',
    });

    const page = {
      goto,
      newTab,
      selectTab,
      wait,
      waitForCapture,
      evaluate,
      installInterceptor,
      click,
      pressKey,
      getInterceptedRequests,
      waitForDownload,
    };

    click.mockImplementation(async (selector) => {
      if (selector === '[data-opencli-shopdora-product-shopdora-download-target="query-button"]') {
        queryClickCount += 1;
      }
    });

    const result = await command.func(page, {
      shopeeProductUrl: 'https://shopee.sg/READY-STOCK-CHASE-Microfiber-Short-Pant-With-Pocket-Seluar-Pendek-Lelaki-Sport-Men-Seluar-Sukan-Lelaki-Short-Pants-Shorts-Quick-Dry-i.1273178276.27658353502',
    });

    expect(installInterceptor).toHaveBeenCalledWith(SHOPDORA_API_CAPTURE_PATTERN);
    expect(queryClickCount).toBeGreaterThanOrEqual(2);
    expect(waitForCapture).toHaveBeenCalledWith(5);
    expect(click).not.toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="add-button"]');
    expect(click).not.toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="submit-button"]');
    expect(click).not.toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="confirm-button"]');
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]');
    expect(waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 1800000,
    });
    expect(
      evaluate.mock.calls.some(([script]) => String(script ?? '').includes('const target = "empty-comment-checkbox-input";')),
    ).toBe(false);
    expect(result).toEqual([expect.objectContaining({
      status: 'success',
      local_url: pathToFileURL(downloadedFile).href,
      local_path: downloadedFile,
      download_url: 'https://www.shopdora.com/api/comment/download',
      product_url: 'https://shopee.sg/READY-STOCK-CHASE-Microfiber-Short-Pant-With-Pocket-Seluar-Pendek-Lelaki-Sport-Men-Seluar-Sukan-Lelaki-Short-Pants-Shorts-Quick-Dry-i.1273178276.27658353502',
      taskKey: 'a9d3a6556bbabf099744966eeea0c5bc48b4e159663314b8e5f3cefca630778d',
      site: 'sg',
      shopId: '1273178276',
      itemId: '27658353502',
    })]);
  });

  it('captures and returns the comment/export request while waiting for the download', async () => {
    const downloadedFile = '/tmp/opencli-shopdora-comments/export-comments.csv';
    let pollCount = 0;
    const page = {
      wait: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockImplementation(async (script) => {
        const source = String(script ?? '');
        if (source.includes('const target = "download-comment-button";')) {
          return { ok: true, selector: '[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]' };
        }
        return { ok: true };
      }),
      getInterceptedRequests: vi.fn().mockImplementation(async () => {
        pollCount += 1;
        if (pollCount < 3) return [];
        return [{
          url: 'https://www.shopdora.com/api/comment/export',
          requestBody: '{"taskKey":"task-1"}',
          requestHeaders: { lang: 'zh', endpoint: 'pc' },
          body: JSON.stringify({ code: 'ok', data: {} }),
        }];
      }),
      waitForDownload: vi.fn().mockResolvedValue({
        filename: downloadedFile,
        url: 'https://www.shopdora.com/api/comment/export',
      }),
    };

    await expect(clickDownloadCommentAndWait(page, {
      shopeeProductUrl: 'https://shopee.sg/product/1/2',
      task: { taskKey: 'task-1', site: 'sg', shopId: '1', itemId: '2' },
    })).resolves.toEqual([expect.objectContaining({
      local_url: pathToFileURL(downloadedFile).href,
      export_request_url: 'https://www.shopdora.com/api/comment/export',
      export_request_body: '{"taskKey":"task-1"}',
      taskKey: 'task-1',
    })]);
    expect(page.click).toHaveBeenCalledWith('[data-opencli-shopdora-product-shopdora-download-target="download-comment-button"]');
    expect(page.waitForDownload).toHaveBeenCalledWith({
      startedAfterMs: expect.any(Number),
      timeoutMs: 1800000,
    });
  });
});
