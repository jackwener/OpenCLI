import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const BASE_URL = 'https://sso.geiwohuo.com';
const FEEDBACK_PAGE_URL = `${BASE_URL}/#/mgs/store-management/product-feedback`;
const COMMENT_LIST_API = `${BASE_URL}/mgs-api-prefix/goods/comment/list`;

export const SHEIN_FEEDBACK_COLUMNS = [
    'commentId',
    'countrySiteCn',
    'supplierId',
    'goodsTitle',
    'goodsThumb',
    'goodsAttribute',
    'goodsUrl',
    'goodSn',
    'spu',
    'skc',
    'sku',
    'goodsCommentStar',
    'goodsCommentStarName',
    'goodsCommentContent',
    'goodsCommentImages',
    'logisticCommentStar',
    'logisticCommentContent',
    'commentTime',
    'orderTime',
    'billNo',
    'memberOverallFitLabelList',
    'badCommentLabelList',
];

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asRecordArray(value) {
    return asArray(value).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function stringValue(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
}

function numberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function normalizeUrl(raw) {
    const value = stringValue(raw).trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    return value;
}

function normalizeImageList(value) {
    return [...new Set(asArray(value)
        .map((item) => {
            if (typeof item === 'string') return normalizeUrl(item);
            const row = asObject(item);
            return normalizeUrl(row.url || row.imgUrl || row.imageUrl || row.image || row.src);
        })
        .filter(Boolean))];
}

function joinLabels(value) {
    return asArray(value)
        .map((item) => {
            if (typeof item === 'string') return item;
            const row = asObject(item);
            return stringValue(row.labelName || row.name || row.label || row.commentLabelName || row.badCommentLabelName);
        })
        .map((item) => item.trim())
        .filter(Boolean)
        .join(',');
}

function normalizeCommentTimeInput(raw, label) {
    const text = stringValue(raw).trim();
    if (!text) return '';
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (!match) {
        throw new CommandExecutionError(`${label} must be YYYY-M-D or YYYY-M-D HH:mm[:ss]. Received: "${text}"`);
    }
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    const pad = (value) => String(Number(value)).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function normalizeCommentTimeValue(raw) {
    const value = stringValue(raw).trim();
    if (!value) return '';
    return normalizeCommentTimeInput(value, 'commentTime');
}

export function flattenSheinFeedbackComment(comment) {
    const row = asObject(comment);
    return {
        commentId: stringValue(row.commentId),
        countrySiteCn: stringValue(row.countrySiteCn),
        supplierId: stringValue(row.supplierId),
        goodsTitle: stringValue(row.goodsTitle),
        goodsThumb: normalizeUrl(row.goodsThumb),
        goodsAttribute: stringValue(row.goodsAttribute),
        goodsUrl: normalizeUrl(row.goodsUrl),
        goodSn: stringValue(row.goodSn),
        spu: stringValue(row.spu),
        skc: stringValue(row.skc),
        sku: stringValue(row.sku),
        goodsCommentStar: numberOrNull(row.goodsCommentStar) ?? 0,
        goodsCommentStarName: stringValue(row.goodsCommentStarName),
        goodsCommentContent: stringValue(row.goodsCommentContent),
        goodsCommentImages: normalizeImageList(row.goodsCommentImages),
        logisticCommentStar: numberOrNull(row.logisticCommentStar) ?? '',
        logisticCommentContent: stringValue(row.logisticCommentContent),
        commentTime: stringValue(row.commentTime),
        orderTime: stringValue(row.orderTime),
        billNo: stringValue(row.billNo),
        memberOverallFitLabelList: joinLabels(row.memberOverallFitLabelList),
        badCommentLabelList: joinLabels(row.badCommentLabelList),
    };
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function lowerCaseKeys(record) {
    const source = asObject(record);
    const lowered = {};
    for (const [key, value] of Object.entries(source)) {
        lowered[String(key).toLowerCase()] = stringValue(value);
    }
    return lowered;
}

function parseJsonText(raw, label) {
    const text = stringValue(raw).trim();
    if (!text) throw new CommandExecutionError(`Missing ${label}`);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new CommandExecutionError(`Malformed ${label}: ${error?.message || error}`);
    }
}

function ensureSuccessfulApiPayload(payload, label) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError(`Malformed ${label}`);
    }
    if (payload.code !== undefined && String(payload.code) !== '0') {
        throw new CommandExecutionError(`SHEIN ${label} failed: code=${String(payload.code)} msg=${stringValue(payload.msg)}`);
    }
    return payload;
}

function urlMatchesApi(rawUrl, apiUrl) {
    const value = stringValue(rawUrl);
    if (!value) return false;
    if (value.includes(apiUrl)) return true;
    try {
        return value.includes(new URL(apiUrl).pathname);
    } catch {
        return false;
    }
}

function filterReplayableHeaders(headers) {
    const lowered = lowerCaseKeys(headers);
    const replayable = {};
    for (const name of ['accept', 'accept-language', 'build-version', 'content-type', 'origin-path', 'origin-url', 'x-log-visitorid']) {
        if (lowered[name]) replayable[name] = lowered[name];
    }
    return replayable;
}

function extractCommentListCaptureContext(entries) {
    const match = [...asArray(entries)].reverse().find((entry) => {
        const row = asObject(entry);
        return urlMatchesApi(row.url, COMMENT_LIST_API)
            && stringValue(row.responsePreview).trim()
            && numberOrNull(row.responseStatus) !== null
            && numberOrNull(row.responseStatus) < 400;
    });
    if (!match) {
        throw new CommandExecutionError('Failed to capture SHEIN feedback first-page list request');
    }
    const requestBody = asObject(parseJsonText(match.requestBodyPreview, 'SHEIN feedback list request body'));
    const response = ensureSuccessfulApiPayload(parseJsonText(match.responsePreview, 'SHEIN feedback list response'), 'feedback list response');
    return {
        headers: filterReplayableHeaders(match.requestHeaders),
        body: requestBody,
        response,
    };
}

function getRows(payload) {
    return asRecordArray(asObject(payload?.info).data);
}

function getTotalCount(info) {
    const source = asObject(info);
    for (const key of ['total', 'totalCount', 'count']) {
        const parsed = numberOrNull(source[key]);
        if (parsed !== null) return parsed;
    }
    const meta = asObject(source.meta);
    for (const key of ['total', 'totalCount', 'count']) {
        const parsed = numberOrNull(meta[key]);
        if (parsed !== null) return parsed;
    }
    return null;
}

function parsePositiveInt(raw, label, fallback) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new CommandExecutionError(`${label} must be a positive integer. Received: "${String(raw)}"`);
    }
    return parsed;
}

function parseNonNegativeInt(raw, label, fallback) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new CommandExecutionError(`${label} must be a non-negative integer. Received: "${String(raw)}"`);
    }
    return parsed;
}

function buildPaginatedCommentBody(firstPageBody, pageNo, perPageOverride) {
    const body = { ...asObject(firstPageBody) };
    const pageKey = ['page', 'pageNo', 'pageNum', 'currentPage'].find((key) => body[key] !== undefined) || 'page';
    body[pageKey] = pageNo;
    if (perPageOverride !== undefined && perPageOverride !== null) {
        const sizeKey = ['perPage', 'pageSize', 'limit'].find((key) => body[key] !== undefined) || 'perPage';
        body[sizeKey] = perPageOverride;
    }
    return body;
}

function applyCommentTimeRangeToBody(body, options = {}) {
    const next = { ...asObject(body) };
    if (options.sinceCommentTime) {
        next.startCommentTime = options.sinceCommentTime;
    }
    if (options.untilCommentTime) {
        next.commentEndTime = options.untilCommentTime;
    }
    return next;
}

function buildCommentListBody(firstPageBody, pageNo, options) {
    return applyCommentTimeRangeToBody(
        buildPaginatedCommentBody(firstPageBody, pageNo, options.perPage ?? firstPageBody.perPage ?? firstPageBody.pageSize),
        options,
    );
}

function pageSizeFromBody(body, fallbackRows) {
    const source = asObject(body);
    for (const key of ['perPage', 'pageSize', 'limit']) {
        const parsed = numberOrNull(source[key]);
        if (parsed !== null && parsed > 0) return parsed;
    }
    return fallbackRows || 50;
}

function filterCommentsByTime(comments, sinceCommentTime, untilCommentTime) {
    const source = asRecordArray(comments);
    const filtered = source.filter((comment) => {
        const commentTime = normalizeCommentTimeValue(comment.commentTime);
        if (!commentTime) return !sinceCommentTime && !untilCommentTime;
        if (sinceCommentTime && commentTime <= sinceCommentTime) return false;
        if (untilCommentTime && commentTime > untilCommentTime) return false;
        return true;
    });
    return {
        comments: filtered,
        shouldStop: Boolean(sinceCommentTime) && source.some((comment) => {
            const commentTime = normalizeCommentTimeValue(comment.commentTime);
            return commentTime && commentTime <= sinceCommentTime;
        }),
    };
}

function buildTapCaptureJs({ pattern, timeoutMs, targetUrl, clickSearch = false, reloadIfSameUrl = false }) {
    return `
      (async () => {
        const pattern = ${JSON.stringify(pattern)};
        const timeoutMs = ${JSON.stringify(timeoutMs)};
        const targetUrl = ${JSON.stringify(targetUrl || '')};
        const clickSearch = ${clickSearch ? 'true' : 'false'};
        const reloadIfSameUrl = ${reloadIfSameUrl ? 'true' : 'false'};
        const captures = [];
        const errors = [];
        let finished = false;
        let resolveCapture;
        const capturePromise = new Promise((resolve) => { resolveCapture = resolve; });

        const visible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const textOf = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const pushCapture = (payload) => {
          captures.push(payload);
          if (!finished) {
            finished = true;
            resolveCapture(true);
          }
        };
        const readHeaders = (value) => {
          try {
            if (!value) return {};
            if (value instanceof Headers) return Object.fromEntries(value.entries());
            if (Array.isArray(value)) return Object.fromEntries(value.map(([k, v]) => [String(k), String(v)]));
            if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [String(k), String(v)]));
          } catch {}
          return {};
        };
        const readBody = async (body, request) => {
          try {
            if (body == null) return '';
            if (typeof body === 'string') return body;
            if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
            if (typeof FormData !== 'undefined' && body instanceof FormData) return '[formdata]';
            if (typeof Blob !== 'undefined' && body instanceof Blob) return '[blob]';
            if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return '[arraybuffer]';
            return String(body);
          } catch {}
          try {
            if (request) return await request.clone().text();
          } catch {}
          return '';
        };

        const origFetch = window.fetch;
        const xhrProto = XMLHttpRequest.prototype;
        const origOpen = xhrProto.open;
        const origSend = xhrProto.send;
        const origSetRequestHeader = xhrProto.setRequestHeader;

        window.fetch = async function (...args) {
          const request = args[0] instanceof Request ? args[0] : null;
          const init = args[1] || {};
          const reqUrl = request ? request.url : String(args[0] || '');
          const reqMethod = String(init.method || request?.method || 'GET').toUpperCase();
          const reqHeaders = readHeaders(init.headers || request?.headers);
          const reqBody = await readBody(init.body, request);
          const response = await origFetch.apply(this, args);
          if (pattern && reqUrl.includes(pattern)) {
            try {
              const text = await response.clone().text();
              pushCapture({
                kind: 'fetch',
                url: reqUrl,
                method: reqMethod,
                requestHeaders: reqHeaders,
                requestBodyPreview: reqBody,
                responseStatus: response.status,
                responsePreview: text,
                timestamp: Date.now(),
              });
            } catch (error) {
              errors.push({ kind: 'fetch', url: reqUrl, error: String(error) });
            }
          }
          return response;
        };

        xhrProto.open = function (method, url) {
          this.__opencliSheinFeedbackUrl = String(url || '');
          this.__opencliSheinFeedbackMethod = String(method || 'GET').toUpperCase();
          this.__opencliSheinFeedbackHeaders = {};
          return origOpen.apply(this, arguments);
        };
        xhrProto.setRequestHeader = function (name, value) {
          try {
            const headers = this.__opencliSheinFeedbackHeaders || {};
            headers[String(name)] = String(value);
            this.__opencliSheinFeedbackHeaders = headers;
          } catch {}
          return origSetRequestHeader.apply(this, arguments);
        };
        xhrProto.send = function (body) {
          const reqUrl = String(this.__opencliSheinFeedbackUrl || '');
          if (pattern && reqUrl.includes(pattern)) {
            const reqMethod = String(this.__opencliSheinFeedbackMethod || 'GET');
            const reqHeaders = this.__opencliSheinFeedbackHeaders || {};
            const reqBody = body == null ? '' : String(body);
            this.addEventListener('load', function () {
              try {
                pushCapture({
                  kind: 'xhr',
                  url: reqUrl,
                  method: reqMethod,
                  requestHeaders: reqHeaders,
                  requestBodyPreview: reqBody,
                  responseStatus: this.status,
                  responsePreview: String(this.responseText || ''),
                  timestamp: Date.now(),
                });
              } catch (error) {
                errors.push({ kind: 'xhr', url: reqUrl, error: String(error) });
              }
            }, { once: true });
          }
          return origSend.apply(this, arguments);
        };

        const restore = () => {
          try { window.fetch = origFetch; } catch {}
          try { xhrProto.open = origOpen; } catch {}
          try { xhrProto.send = origSend; } catch {}
          try { xhrProto.setRequestHeader = origSetRequestHeader; } catch {}
        };

        try {
          if (targetUrl) {
            if (location.href !== targetUrl) {
              location.href = targetUrl;
              await new Promise((resolve) => setTimeout(resolve, 1500));
            } else if (reloadIfSameUrl) {
              location.reload();
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
          if (clickSearch) {
            const deadline = Date.now() + Math.min(timeoutMs, 15000);
            let clicked = false;
            while (Date.now() < deadline) {
              const candidates = Array.from(document.querySelectorAll('button,[role="button"],.el-button,.ant-btn'))
                .filter((el) => visible(el) && textOf(el).includes('搜索'));
              const target = candidates.find((el) => textOf(el) === '搜索') || candidates[0];
              if (target) {
                target.click();
                clicked = true;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            if (!clicked) return { ok: false, reason: 'search button not found', captures, errors, href: location.href };
          }
          const timedOut = await Promise.race([
            capturePromise.then(() => false),
            new Promise((resolve) => setTimeout(() => resolve(true), timeoutMs)),
          ]);
          if (timedOut) return { ok: false, reason: 'capture timeout', captures, errors, href: location.href };
          return { ok: true, captures, errors, href: location.href };
        } finally {
          restore();
        }
      })()
    `;
}

async function captureRequestViaPageTap(page, { pattern, timeoutMs, targetUrl, clickSearch, label, reloadIfSameUrl = false }) {
    const result = unwrapEvaluateResult(await page.evaluate(buildTapCaptureJs({ pattern, timeoutMs, targetUrl, clickSearch, reloadIfSameUrl })));
    if (!result?.ok) {
        throw new CommandExecutionError(`${label} failed: ${stringValue(result?.reason) || 'unknown reason'}`);
    }
    if (asArray(result.errors).length > 0) {
        const first = asObject(asArray(result.errors)[0]);
        throw new CommandExecutionError(`${label} capture failed: ${stringValue(first.error) || JSON.stringify(first)}`);
    }
    return asArray(result.captures);
}

async function ensureFeedbackPage(page) {
    await page.goto(FEEDBACK_PAGE_URL);
    await page.wait(4);
    const href = stringValue(unwrapEvaluateResult(await page.evaluate('location.href')));
    if (href.startsWith(BASE_URL)) return;
    throw new CommandExecutionError(`SHEIN feedback navigation failed before API fetch: current=${href || '<empty>'}`);
}

async function captureFirstCommentPage(page, options) {
    await ensureFeedbackPage(page);
    let captures;
    try {
        captures = await captureRequestViaPageTap(page, {
            pattern: '/mgs-api-prefix/goods/comment/list',
            timeoutMs: options.timeoutMs,
            targetUrl: FEEDBACK_PAGE_URL,
            clickSearch: true,
            label: 'SHEIN feedback first-page list response',
        });
    } catch (error) {
        if (!String(error?.message || error).includes('search button not found')) throw error;
        captures = await captureRequestViaPageTap(page, {
            pattern: '/mgs-api-prefix/goods/comment/list',
            timeoutMs: options.timeoutMs,
            targetUrl: FEEDBACK_PAGE_URL,
            clickSearch: false,
            reloadIfSameUrl: true,
            label: 'SHEIN feedback first-page list response',
        });
    }
    return extractCommentListCaptureContext(captures);
}

async function fetchCommentPage(page, headers, baseBody, pageNo, options) {
    let lastError = '';
    for (let attempt = 1; attempt <= options.retryAttempts; attempt++) {
        try {
            const payload = await page.fetchJson(COMMENT_LIST_API, {
                method: 'POST',
                headers,
                body: buildCommentListBody(baseBody, pageNo, options),
                timeoutMs: options.timeoutMs,
            });
            return ensureSuccessfulApiPayload(payload, `feedback page ${pageNo} response`);
        } catch (error) {
            lastError = error?.message || String(error);
            if (attempt >= options.retryAttempts) break;
            await page.wait(options.retryDelayMs * attempt / 1000);
        }
    }
    throw new CommandExecutionError(`SHEIN feedback page ${pageNo} fetch failed: ${lastError}`);
}

export async function collectSheinFeedbackRows(page, kwargs) {
    const options = {
        limit: kwargs.limit === undefined || kwargs.limit === null || kwargs.limit === ''
            ? null
            : parsePositiveInt(kwargs.limit, '--limit', 1),
        perPage: kwargs.perPage === undefined || kwargs.perPage === null || kwargs.perPage === ''
            ? null
            : parsePositiveInt(kwargs.perPage, '--perPage', 1),
        maxPages: kwargs.maxPages === undefined || kwargs.maxPages === null || kwargs.maxPages === ''
            ? Number.MAX_SAFE_INTEGER
            : parsePositiveInt(kwargs.maxPages, '--maxPages', 1),
        timeoutMs: parsePositiveInt(kwargs.requestTimeout, '--requestTimeout', 60) * 1000,
        retryAttempts: parsePositiveInt(kwargs.retryAttempts, '--retryAttempts', 3),
        retryDelayMs: parseNonNegativeInt(kwargs.retryDelayMs, '--retryDelayMs', 1000),
        sinceCommentTime: normalizeCommentTimeInput(kwargs.sinceCommentTime, '--sinceCommentTime'),
        untilCommentTime: normalizeCommentTimeInput(kwargs.untilCommentTime, '--untilCommentTime'),
    };
    const firstPage = await captureFirstCommentPage(page, options);
    const baseBody = applyCommentTimeRangeToBody(firstPage.body, options);
    const shouldReplayFirstPage = Boolean(options.sinceCommentTime || options.untilCommentTime || options.perPage);
    const firstPayload = shouldReplayFirstPage
        ? await fetchCommentPage(page, firstPage.headers, baseBody, 1, options)
        : firstPage.response;
    const firstInfo = asObject(firstPayload.info);
    const firstRows = getRows(firstPayload);
    const pageSize = options.perPage ?? pageSizeFromBody(baseBody, firstRows.length);
    const total = getTotalCount(firstInfo);
    const comments = [];
    const firstFiltered = filterCommentsByTime(firstRows, options.sinceCommentTime, options.untilCommentTime);
    comments.push(...(options.limit == null ? firstFiltered.comments : firstFiltered.comments.slice(0, options.limit)));
    let shouldStop = firstFiltered.shouldStop;

    for (let pageNo = 2; pageNo <= options.maxPages; pageNo++) {
        if (options.limit != null && comments.length >= options.limit) break;
        if (shouldStop) break;
        if (total !== null && comments.length >= total) break;

        const payload = await fetchCommentPage(page, firstPage.headers, baseBody, pageNo, options);
        const rawRows = getRows(payload);
        if (rawRows.length === 0) break;
        const filtered = filterCommentsByTime(rawRows, options.sinceCommentTime, options.untilCommentTime);
        const remaining = options.limit == null ? filtered.comments.length : Math.max(0, options.limit - comments.length);
        comments.push(...(options.limit == null ? filtered.comments : filtered.comments.slice(0, remaining)));
        shouldStop = filtered.shouldStop;
        if (rawRows.length < pageSize) break;
    }

    return comments.map(flattenSheinFeedbackComment);
}

cli({
    site: 'shein',
    name: 'feedback',
    access: 'read',
    description: '拉取 SHEIN 商品评价列表',
    example: 'opencli shein feedback --limit 20 -f json',
    domain: 'sso.geiwohuo.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    defaultFormat: 'json',
    args: [
        { name: 'limit', type: 'int', help: '最多获取的评价数量；不传则拉取全部' },
        { name: 'perPage', type: 'int', help: '列表接口每页数量；不传则沿用页面请求' },
        { name: 'maxPages', type: 'int', help: '最多拉取页数，调试用' },
        { name: 'sinceCommentTime', help: '只获取 commentTime 大于该时间的评价，支持 YYYY-M-D 或 YYYY-M-D HH:mm[:ss]' },
        { name: 'untilCommentTime', help: '只获取 commentTime 小于等于该时间的评价，支持 YYYY-M-D 或 YYYY-M-D HH:mm[:ss]' },
        { name: 'timeout', type: 'int', default: 3600, help: '整条 SHEIN 商品评价命令总超时时间（秒）；全量拉取建议调大' },
        { name: 'requestTimeout', type: 'int', default: 60, help: '单个 SHEIN 页面 API 请求超时时间（秒）' },
        { name: 'retryAttempts', type: 'int', default: 3, help: '页面 API 网络/5xx 失败重试次数' },
        { name: 'retryDelayMs', type: 'int', default: 1000, help: '页面 API 重试基础间隔毫秒；会按尝试次数线性递增' },
    ],
    columns: SHEIN_FEEDBACK_COLUMNS,
    func: collectSheinFeedbackRows,
});

export const __test__ = {
    flattenSheinFeedbackComment,
    normalizeCommentTimeInput,
    filterCommentsByTime,
    buildPaginatedCommentBody,
    applyCommentTimeRangeToBody,
    buildCommentListBody,
    extractCommentListCaptureContext,
    joinLabels,
    normalizeImageList,
};
