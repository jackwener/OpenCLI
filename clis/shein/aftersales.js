import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const BASE_URL = 'https://sso.geiwohuo.com';
const LIST_PAGE_URL = `${BASE_URL}/#/gsp/order-management/after-sales-list`;
const LIST_API = `${BASE_URL}/gsp/aftersalesOrder/list`;
const DETAIL_API = `${BASE_URL}/gsp/aftersalesOrder/detail`;
const EVIDENCE_API = `${BASE_URL}/gsp/aftersalesOrder/evidenceWorkOrderDetail`;
const CAPTURE_VAR = '__opencli_shein_capture';
const CAPTURE_ERROR_VAR = '__opencli_shein_capture_errors';
const CAPTURE_GUARD = '__opencli_shein_capture_patched';
const EVIDENCE_UNSUPPORTED_CODES = new Set(['9967004']);
const RANDOM_DELAY_MIN_MS = 2000;
const RANDOM_DELAY_MAX_MS = 4000;

export const SHEIN_AFTERSALES_COLUMNS = [
    'requestTime',
    'aftersalesOrderNo',
    'returnOrderNo',
    'orderNo',
    'site',
    'orderSubStatusName',
    'aftersalesResolutionPlanName',
    'refundMethod',
    'sellerResolutionPlanName',
    'sellerInstruction',
    'etaTime',
    'goodsThumb',
    'goodsTitle',
    'goodsSn',
    'suffix',
    'skuSn',
    'quantity',
    'afterSalesReason',
    'buyerInstruction',
    'returnExpressNos',
    'return_attachments',
    'priceAmount',
    'checkEstimateIncomeMoney',
    'returnExpense',
    'performancePrice',
    'promotionAmount',
    'refundRatio',
    'estimateIncomeMoney',
    'goodsSettlePrice',
    'goodsServiceCharge',
    'freezeAmount',
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

function normalizeAttachments(values) {
    return [...new Set(values.map(normalizeUrl).filter(Boolean))];
}

function listReasons(order, fallback) {
    const fromList = asRecordArray(order.afterSalesReasonList)
        .map((reason) => stringValue(reason.reasonName))
        .filter(Boolean);
    if (fromList.length > 0) return fromList.join(',');
    const raw = fallback?.reasons;
    if (Array.isArray(raw)) return raw.map(stringValue).filter(Boolean).join(',');
    return stringValue(raw).split(/[,，]/).map((item) => item.trim()).filter(Boolean).join(',');
}

function goodsMatchScore(detailGoods, listGoods) {
    let score = 0;
    if (stringValue(detailGoods.entityId) && stringValue(detailGoods.entityId) === stringValue(listGoods.entityId)) score += 8;
    if (stringValue(detailGoods.id) && stringValue(detailGoods.id) === stringValue(listGoods.goodsId)) score += 4;
    for (const key of ['skuSn', 'goodsSn', 'suffix']) {
        if (stringValue(detailGoods[key]) && stringValue(detailGoods[key]) === stringValue(listGoods[key])) score += 2;
    }
    return score;
}

function matchedDetailGoodsForListGoods(detail, listGoods) {
    const goodsList = asRecordArray(asObject(detail.goodsInfo).goodsList);
    const scored = goodsList
        .map((goods) => ({ goods, score: goodsMatchScore(goods, listGoods) }))
        .sort((a, b) => b.score - a.score);
    return scored[0]?.score ? scored[0].goods : (goodsList.length === 1 ? goodsList[0] : {});
}

function attachmentsForGoods(detail, listGoods, returnOrderNo, detailGoods = matchedDetailGoodsForListGoods(detail, listGoods)) {
    if (!returnOrderNo) {
        return normalizeAttachments(asArray(detail.buyerImages));
    }

    const source = detailGoods && Object.keys(detailGoods).length > 0 ? detailGoods : undefined;
    if (source) return normalizeAttachments([...asArray(source.images), ...asArray(source.videos)]);

    const goodsList = asRecordArray(asObject(detail.goodsInfo).goodsList);
    return normalizeAttachments(goodsList.flatMap((goods) => [...asArray(goods.images), ...asArray(goods.videos)]));
}

function returnExpressNos(order) {
    return [...new Set(asRecordArray(asObject(order).returnExpressInfoList)
        .map((item) => stringValue(item.expressNo).trim())
        .filter((value) => !/^https?:\/\//i.test(value) && !value.startsWith('//'))
        .filter(Boolean))];
}

function formatRatio(value) {
    const ratio = numberOrNull(value);
    if (ratio === null || ratio <= 0) return '100';
    return Number.isInteger(ratio) ? String(ratio) : String(ratio);
}

function refundMethod(planName, refundRatio) {
    const plan = stringValue(planName);
    if (plan === '退货退款') return '退货退款';
    if (plan === '仅退款') return `仅退款${formatRatio(refundRatio)}%`;
    return '';
}

export function flattenSheinAftersalesOrder(order, detail) {
    const goodsInfos = asRecordArray(order.afterSalesOrderGoodsInfos);
    const returnOrderNo = stringValue(order.returnOrderNo);
    const rows = goodsInfos.length > 0 ? goodsInfos : [{}];

    return rows.map((goods) => {
        const detailGoods = matchedDetailGoodsForListGoods(detail, goods);
        const aftersalesResolutionPlanName = stringValue(order.aftersalesResolutionPlanName);
        const refundRatio = numberOrNull(detailGoods.refundRatio) ?? numberOrNull(detail.refundRatio) ?? 0;
        return {
            requestTime: stringValue(order.requestTime),
            aftersalesOrderNo: stringValue(order.aftersalesOrderNo),
            returnOrderNo,
            orderNo: stringValue(order.orderNo),
            site: stringValue(order.site),
            orderSubStatusName: stringValue(order.orderSubStatusName),
            aftersalesResolutionPlanName,
            refundMethod: refundMethod(aftersalesResolutionPlanName, refundRatio),
            sellerResolutionPlanName: stringValue(detail.resolutionPlanShowName),
            sellerInstruction: stringValue(detail.sellerInstruction),
            etaTime: stringValue(asObject(order.afterSalesStatusGuide).etaTime),
            goodsThumb: normalizeUrl(goods.goodsThumb),
            goodsTitle: stringValue(goods.goodsTitle),
            goodsSn: stringValue(goods.goodsSn),
            suffix: stringValue(goods.suffix),
            skuSn: stringValue(goods.skuSn),
            quantity: numberOrNull(goods.quantity) ?? numberOrNull(goods.number) ?? 0,
            afterSalesReason: listReasons(order, detail),
            buyerInstruction: stringValue(detail.buyerInstruction),
            returnExpressNos: returnExpressNos(order),
            return_attachments: attachmentsForGoods(detail, goods, returnOrderNo, detailGoods),
            priceAmount: numberOrNull(goods.priceAmount) ?? 0,
            checkEstimateIncomeMoney: numberOrNull(goods.checkEstimateIncomeMoney) ?? 0,
            returnExpense: numberOrNull(goods.returnExpense) ?? 0,
            performancePrice: numberOrNull(goods.performancePrice) ?? numberOrNull(detailGoods.returnPerformance) ?? 0,
            promotionAmount: numberOrNull(detailGoods.promotionAmount) ?? 0,
            refundRatio,
            estimateIncomeMoney: numberOrNull(detailGoods.estimateIncomeMoney) ?? 0,
            goodsSettlePrice: numberOrNull(detailGoods.goodsSettlePrice) ?? 0,
            goodsServiceCharge: numberOrNull(detailGoods.goodsServiceCharge) ?? 0,
            freezeAmount: numberOrNull(goods.freezeAmount) ?? numberOrNull(detailGoods.freezeAmount) ?? numberOrNull(order.freezeAmount) ?? 0,
        };
    });
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

function normalizeRequestTimeInput(raw) {
    const text = stringValue(raw).trim();
    if (!text) return '';
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/);
    if (!match) {
        throw new CommandExecutionError(`--sinceRequestTime must be YYYY-M-D or YYYY-M-D HH:mm:ss. Received: "${text}"`);
    }
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    const pad = (value) => String(Number(value)).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function filterOrdersAfterSince(orders, sinceRequestTime) {
    const source = asRecordArray(orders);
    if (!sinceRequestTime) return { orders: source, shouldStop: false };
    return {
        orders: source.filter((order) => stringValue(order.requestTime) > sinceRequestTime),
        shouldStop: source.some((order) => stringValue(order.requestTime) <= sinceRequestTime),
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

function parseJsonText(raw, label) {
    const text = stringValue(raw).trim();
    if (!text) {
        throw new CommandExecutionError(`Missing ${label}`);
    }
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

function filterReplayableHeaders(headers) {
    const lowered = lowerCaseKeys(headers);
    const replayable = {};
    for (const name of ['accept', 'accept-language', 'build-version', 'content-type', 'origin-path', 'origin-url', 'x-log-visitorid']) {
        if (lowered[name]) replayable[name] = lowered[name];
    }
    return replayable;
}

function extractListCaptureContext(entries) {
    const match = [...asArray(entries)].reverse().find((entry) => {
        const row = asObject(entry);
        return urlMatchesApi(row.url, LIST_API)
            && stringValue(row.responsePreview).trim()
            && numberOrNull(row.responseStatus) !== null
            && numberOrNull(row.responseStatus) < 400;
    });
    if (!match) {
        throw new CommandExecutionError('Failed to capture SHEIN first-page list request');
    }
    const requestBody = asObject(parseJsonText(match.requestBodyPreview, 'SHEIN list request body'));
    const response = ensureSuccessfulApiPayload(parseJsonText(match.responsePreview, 'SHEIN list response'), 'list response');
    return {
        headers: filterReplayableHeaders(match.requestHeaders),
        body: requestBody,
        response,
    };
}

function extractDetailFromCapture(entries, aftersalesOrderId) {
    const wantedId = stringValue(aftersalesOrderId);
    const match = [...asArray(entries)].reverse().find((entry) => {
        const row = asObject(entry);
        if (!urlMatchesApi(row.url, DETAIL_API)) return false;
        if (!stringValue(row.responsePreview).trim()) return false;
        const requestBody = asObject(parseJsonText(row.requestBodyPreview, 'SHEIN detail request body'));
        return stringValue(requestBody.aftersalesOrderId) === wantedId;
    });
    if (!match) {
        throw new CommandExecutionError(`Failed to capture SHEIN detail response for aftersalesOrderId=${wantedId}`);
    }
    return ensureSuccessfulApiPayload(parseJsonText(match.responsePreview, 'SHEIN detail response'), 'detail response');
}

function extractEvidenceFromCapture(entries, aftersalesOrderNo) {
    const wantedNo = stringValue(aftersalesOrderNo);
    const match = [...asArray(entries)].reverse().find((entry) => {
        const row = asObject(entry);
        if (!urlMatchesApi(row.url, EVIDENCE_API)) return false;
        if (!stringValue(row.responsePreview).trim()) return false;
        const requestBody = asObject(parseJsonText(row.requestBodyPreview, 'SHEIN evidence request body'));
        return !wantedNo || stringValue(requestBody.aftersalesOrderNo) === wantedNo;
    });
    if (!match) return { info: null };

    const payload = parseJsonText(match.responsePreview, 'SHEIN evidence response');
    if (payload?.code !== undefined && String(payload.code) !== '0') {
        if (EVIDENCE_UNSUPPORTED_CODES.has(String(payload.code))) return { info: null };
        return ensureSuccessfulApiPayload(payload, 'evidence response');
    }
    return ensureSuccessfulApiPayload(payload, 'evidence response');
}

function evidenceDetailInfo(payload) {
    const info = payload?.info;
    return asRecordArray(info)[0] || asObject(info);
}

function mergeDetailAndEvidence(detailPayload, evidencePayload) {
    const primaryDetail = asObject(detailPayload?.info);
    const evidenceDetail = evidenceDetailInfo(evidencePayload);
    if (Object.keys(evidenceDetail).length === 0) return primaryDetail;
    return {
        ...evidenceDetail,
        ...primaryDetail,
        buyerInstruction: stringValue(evidenceDetail.buyerInstruction) || stringValue(primaryDetail.buyerInstruction),
        resolutionPlanShowName: stringValue(evidenceDetail.resolutionPlanShowName) || stringValue(primaryDetail.resolutionPlanShowName),
        sellerInstruction: stringValue(evidenceDetail.sellerInstruction) || stringValue(primaryDetail.sellerInstruction),
    };
}

function buildPaginatedListBody(firstPageBody, page, perPageOverride) {
    const body = { ...asObject(firstPageBody), page };
    if (perPageOverride !== undefined) body.perPage = perPageOverride;
    return body;
}

function randomDelayMs(randomFn = Math.random) {
    return RANDOM_DELAY_MIN_MS + Math.floor(randomFn() * (RANDOM_DELAY_MAX_MS - RANDOM_DELAY_MIN_MS + 1));
}

async function waitRandomDelay(page, randomFn = Math.random) {
    await page.wait(randomDelayMs(randomFn) / 1000);
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

function buildInstallCaptureJs(pattern) {
    return `
      (() => {
        const CAPTURE_VAR = ${JSON.stringify(CAPTURE_VAR)};
        const ERROR_VAR = ${JSON.stringify(CAPTURE_ERROR_VAR)};
        const GUARD_VAR = ${JSON.stringify(CAPTURE_GUARD)};
        const pattern = ${JSON.stringify(pattern)};

        const defHidden = (obj, key, val) => {
          try {
            Object.defineProperty(obj, key, { value: val, writable: true, enumerable: false, configurable: true });
          } catch {
            obj[key] = val;
          }
        };
        const pushError = (payload) => {
          window[ERROR_VAR].push(payload);
        };
        const normalizeHeaders = async (value) => {
          try {
            if (!value) return {};
            if (value instanceof Headers) return Object.fromEntries(value.entries());
            if (Array.isArray(value)) return Object.fromEntries(value);
            if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
          } catch {}
          return {};
        };
        const normalizeBody = async (value) => {
          if (value == null) return '';
          if (typeof value === 'string') return value;
          if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return value.toString();
          if (typeof FormData !== 'undefined' && value instanceof FormData) return '[formdata]';
          if (typeof Blob !== 'undefined' && value instanceof Blob) return '[blob]';
          if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return '[arraybuffer]';
          return String(value);
        };

        if (!Array.isArray(window[CAPTURE_VAR])) defHidden(window, CAPTURE_VAR, []);
        if (!Array.isArray(window[ERROR_VAR])) defHidden(window, ERROR_VAR, []);
        defHidden(window, GUARD_VAR + '_pattern', pattern);

        if (window[GUARD_VAR]) return;

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
          const request = args[0] instanceof Request ? args[0] : null;
          const init = args[1] || {};
          const reqUrl = request ? request.url : String(args[0] || '');
          const reqMethod = String(init.method || request?.method || 'GET').toUpperCase();
          const reqHeaders = await normalizeHeaders(init.headers || request?.headers);
          let reqBody = '';
          try {
            if (init.body !== undefined) reqBody = await normalizeBody(init.body);
            else if (request) reqBody = await request.clone().text();
          } catch {}

          const response = await origFetch.apply(this, args);
          if ((window[GUARD_VAR + '_pattern'] || '') && reqUrl.includes(window[GUARD_VAR + '_pattern'])) {
            try {
              const clone = response.clone();
              const text = await clone.text();
              window[CAPTURE_VAR].push({
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
              pushError({ kind: 'fetch', url: reqUrl, error: String(error) });
            }
          }
          return response;
        };

        const XHR = XMLHttpRequest.prototype;
        const origOpen = XHR.open;
        const origSend = XHR.send;
        const origSetRequestHeader = XHR.setRequestHeader;

        XHR.open = function (method, url) {
          defHidden(this, '__opencli_shein_url', String(url));
          defHidden(this, '__opencli_shein_method', String(method || 'GET').toUpperCase());
          defHidden(this, '__opencli_shein_headers', {});
          return origOpen.apply(this, arguments);
        };

        XHR.setRequestHeader = function (name, value) {
          try {
            const headers = this.__opencli_shein_headers || {};
            headers[String(name)] = String(value);
            defHidden(this, '__opencli_shein_headers', headers);
          } catch {}
          return origSetRequestHeader.apply(this, arguments);
        };

        XHR.send = function (body) {
          const reqUrl = String(this.__opencli_shein_url || '');
          const reqMethod = String(this.__opencli_shein_method || 'GET');
          const reqHeaders = this.__opencli_shein_headers || {};
          const reqBody = body == null ? '' : String(body);
          if ((window[GUARD_VAR + '_pattern'] || '') && reqUrl.includes(window[GUARD_VAR + '_pattern'])) {
            this.addEventListener('load', function () {
              try {
                window[CAPTURE_VAR].push({
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
                pushError({ kind: 'xhr', url: reqUrl, error: String(error) });
              }
            });
          }
          return origSend.apply(this, arguments);
        };

        defHidden(window, GUARD_VAR, true);
      })()
    `;
}

function buildReadCaptureJs() {
    return `
      (() => {
        const data = Array.isArray(window[${JSON.stringify(CAPTURE_VAR)}]) ? window[${JSON.stringify(CAPTURE_VAR)}] : [];
        const errors = Array.isArray(window[${JSON.stringify(CAPTURE_ERROR_VAR)}]) ? window[${JSON.stringify(CAPTURE_ERROR_VAR)}] : [];
        window[${JSON.stringify(CAPTURE_VAR)}] = [];
        window[${JSON.stringify(CAPTURE_ERROR_VAR)}] = [];
        return { data, errors };
      })()
    `;
}

async function installSheinCapture(page, pattern) {
    await page.evaluate(buildInstallCaptureJs(pattern));
}

async function readSheinCapture(page) {
    const payload = unwrapEvaluateResult(await page.evaluate(buildReadCaptureJs()));
    const data = asArray(payload?.data);
    const errors = asArray(payload?.errors);
    return { data, errors };
}

async function waitForCapture(page, extractor, timeoutMs, label, initialEntries = []) {
    const deadline = Date.now() + timeoutMs;
    const seen = [...asArray(initialEntries)];
    if (seen.length > 0) {
        const seeded = extractor(seen);
        if (seeded) return seeded;
    }
    while (Date.now() < deadline) {
        const batch = await readSheinCapture(page);
        if (batch.errors.length > 0) {
            const first = asObject(batch.errors[0]);
            throw new CommandExecutionError(`${label} capture failed: ${stringValue(first.error) || JSON.stringify(first)}`);
        }
        if (batch.data.length > 0) {
            seen.push(...batch.data);
            const result = extractor(seen);
            if (result) return result;
        }
        await page.wait(0.25);
    }
    throw new CommandExecutionError(`Timed out waiting for ${label}`);
}

async function navigateWithinSheinApp(page, url, waitSeconds = 4) {
    const result = unwrapEvaluateResult(await page.evaluate(`
      (() => {
        const target = ${JSON.stringify(url)};
        try {
          if (location.href !== target) location.href = target;
          return { ok: true, href: location.href };
        } catch (error) {
          return { ok: false, reason: String(error) };
        }
      })()
    `));
    if (!result?.ok) {
        throw new CommandExecutionError(`SHEIN in-app navigation failed: ${stringValue(result?.reason) || 'unknown reason'}`);
    }
    await page.wait(waitSeconds);
}

function buildTapCaptureJs({ pattern, timeoutMs, targetUrl, clickSearch = false, reloadIfSameUrl = false, settleAfterFirstMs = 0 }) {
    return `
      (async () => {
        const pattern = ${JSON.stringify(pattern)};
        const timeoutMs = ${JSON.stringify(timeoutMs)};
        const targetUrl = ${JSON.stringify(targetUrl || '')};
        const clickSearch = ${clickSearch ? 'true' : 'false'};
        const reloadIfSameUrl = ${reloadIfSameUrl ? 'true' : 'false'};
        const settleAfterFirstMs = ${JSON.stringify(settleAfterFirstMs)};
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
        const pushError = (payload) => {
          errors.push(payload);
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
              pushError({ kind: 'fetch', url: reqUrl, error: String(error) });
            }
          }
          return response;
        };

        xhrProto.open = function (method, url) {
          this.__opencliSheinTapUrl = String(url || '');
          this.__opencliSheinTapMethod = String(method || 'GET').toUpperCase();
          this.__opencliSheinTapHeaders = {};
          return origOpen.apply(this, arguments);
        };

        xhrProto.setRequestHeader = function (name, value) {
          try {
            const headers = this.__opencliSheinTapHeaders || {};
            headers[String(name)] = String(value);
            this.__opencliSheinTapHeaders = headers;
          } catch {}
          return origSetRequestHeader.apply(this, arguments);
        };

        xhrProto.send = function (body) {
          const reqUrl = String(this.__opencliSheinTapUrl || '');
          if (pattern && reqUrl.includes(pattern)) {
            const reqMethod = String(this.__opencliSheinTapMethod || 'GET');
            const reqHeaders = this.__opencliSheinTapHeaders || {};
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
                pushError({ kind: 'xhr', url: reqUrl, error: String(error) });
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
            if (!clicked) {
              return { ok: false, reason: 'search button not found', captures, errors, href: location.href };
            }
          }

          const timedOut = await Promise.race([
            capturePromise.then(() => false),
            new Promise((resolve) => setTimeout(() => resolve(true), timeoutMs)),
          ]);
          if (timedOut) {
            return { ok: false, reason: 'capture timeout', captures, errors, href: location.href };
          }
          if (settleAfterFirstMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, settleAfterFirstMs));
          }
          return { ok: true, captures, errors, href: location.href };
        } finally {
          restore();
        }
      })()
    `;
}

async function captureRequestViaPageTap(page, { pattern, timeoutMs, targetUrl, clickSearch, label, reloadIfSameUrl = false, settleAfterFirstMs = 0 }) {
    const result = unwrapEvaluateResult(await page.evaluate(buildTapCaptureJs({
        pattern,
        timeoutMs,
        targetUrl,
        clickSearch,
        reloadIfSameUrl,
        settleAfterFirstMs,
    })));
    if (!result?.ok) {
        throw new CommandExecutionError(`${label} failed: ${stringValue(result?.reason) || 'unknown reason'}`);
    }
    if (asArray(result.errors).length > 0) {
        const first = asObject(asArray(result.errors)[0]);
        throw new CommandExecutionError(`${label} capture failed: ${stringValue(first.error) || JSON.stringify(first)}`);
    }
    return asArray(result.captures);
}

async function clickCurrentSearchButton(page) {
    const result = unwrapEvaluateResult(await page.evaluate(`
      (() => {
        const visible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const textOf = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const candidates = Array.from(document.querySelectorAll('button,[role="button"],.el-button,.ant-btn'))
          .filter((el) => visible(el) && textOf(el).includes('搜索'));
        const target = candidates.find((el) => textOf(el) === '搜索') || candidates[0];
        if (!target) return { ok: false, reason: 'search button not found' };
        target.scrollIntoView({ behavior: 'instant', block: 'center' });
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        target.click();
        return { ok: true, text: textOf(target) };
      })()
    `));
    if (!result?.ok) {
        throw new CommandExecutionError(`Could not click SHEIN search button: ${stringValue(result?.reason) || 'unknown reason'}`);
    }
}

async function fetchListPage(page, headers, baseBody, pageNo, options) {
    let lastError = '';
    for (let attempt = 1; attempt <= options.retryAttempts; attempt++) {
        try {
            const payload = await page.fetchJson(LIST_API, {
                method: 'POST',
                headers,
                body: buildPaginatedListBody(baseBody, pageNo, baseBody.perPage),
                timeoutMs: options.timeoutMs,
            });
            return ensureSuccessfulApiPayload(payload, `list page ${pageNo} response`);
        } catch (error) {
            lastError = error?.message || String(error);
            if (attempt >= options.retryAttempts) break;
            await page.wait(options.retryDelayMs * attempt / 1000);
        }
    }
    throw new CommandExecutionError(`SHEIN list page ${pageNo} fetch failed: ${lastError}`);
}

async function captureListPageOne(page, options) {
    await ensureSheinListPage(page);
    let captures;
    try {
        captures = await captureRequestViaPageTap(page, {
            pattern: '/gsp/aftersalesOrder/list',
            timeoutMs: options.timeoutMs,
            targetUrl: LIST_PAGE_URL,
            clickSearch: true,
            label: 'SHEIN first-page list response',
        });
    } catch (error) {
        const message = String(error?.message || error);
        if (!message.includes('search button not found') && !message.includes('capture timeout')) throw error;
        captures = await captureRequestViaPageTap(page, {
            pattern: '/gsp/aftersalesOrder/list',
            timeoutMs: options.timeoutMs,
            targetUrl: LIST_PAGE_URL,
            clickSearch: false,
            reloadIfSameUrl: true,
            label: 'SHEIN first-page list response',
        });
    }
    return extractListCaptureContext(captures);
}

async function captureDetailPayload(page, order, options) {
    const aftersalesOrderId = stringValue(order.id || order.aftersalesOrderId);
    const aftersalesOrderNo = stringValue(order.aftersalesOrderNo);
    const detailUrl = `${BASE_URL}/#/gsp/order-management/after-sales-detail?aftersalesOrderId=${encodeURIComponent(String(aftersalesOrderId))}`;
    const label = `SHEIN detail response for ${aftersalesOrderId}`;
    await navigateWithinSheinApp(page, LIST_PAGE_URL, 2);
    const captures = await captureRequestViaPageTap(page, {
        pattern: '/gsp/aftersalesOrder/',
        timeoutMs: options.timeoutMs,
        targetUrl: detailUrl,
        clickSearch: false,
        label,
        settleAfterFirstMs: 2000,
    });
    const detailPayload = extractDetailFromCapture(captures, aftersalesOrderId);
    const evidencePayload = extractEvidenceFromCapture(captures, aftersalesOrderNo);
    return { info: mergeDetailAndEvidence(detailPayload, evidencePayload) };
}

async function ensureSheinListPage(page) {
    const currentHref = async () => {
        try {
            return stringValue(unwrapEvaluateResult(await page.evaluate('location.href')));
        } catch {
            return '';
        }
    };

    await page.goto(LIST_PAGE_URL);
    await page.wait(4);

    const href = await currentHref();
    if (href.startsWith(BASE_URL)) return { href, page: page.getActivePage?.() || '' };

    throw new CommandExecutionError(`SHEIN navigation failed before API fetch: current=${href || '<empty>'}`);
}

export async function collectSheinAftersalesRows(page, kwargs) {
    const options = {
        limit: kwargs.limit === undefined || kwargs.limit === null || kwargs.limit === ''
            ? null
            : parsePositiveInt(kwargs.limit, '--limit', 1),
        maxPages: kwargs.maxPages === undefined || kwargs.maxPages === null || kwargs.maxPages === ''
            ? Number.MAX_SAFE_INTEGER
            : parsePositiveInt(kwargs.maxPages, '--max-pages', 1),
        timeoutMs: parsePositiveInt(kwargs.requestTimeout, '--requestTimeout', 60) * 1000,
        retryAttempts: parsePositiveInt(kwargs.retryAttempts, '--retryAttempts', 3),
        retryDelayMs: parseNonNegativeInt(kwargs.retryDelayMs, '--retryDelayMs', 1000),
        sinceRequestTime: normalizeRequestTimeInput(kwargs.sinceRequestTime),
    };
    const pageOne = await captureListPageOne(page, options);
    const pageOneInfo = asObject(pageOne.response.info);
    const pageSize = (numberOrNull(pageOne.body.perPage) ?? asRecordArray(pageOneInfo.data).length) || 50;
    const total = getTotalCount(pageOneInfo);
    const allOrders = [];
    const firstPage = filterOrdersAfterSince(pageOneInfo.data, options.sinceRequestTime);

    allOrders.push(...(options.limit == null ? firstPage.orders : firstPage.orders.slice(0, options.limit)));

    for (let pageNo = 2; pageNo <= options.maxPages; pageNo++) {
        if (options.limit != null && allOrders.length >= options.limit) break;
        if (firstPage.shouldStop) break;
        if (total !== null && allOrders.length >= total) break;

        await waitRandomDelay(page);
        const payload = await fetchListPage(page, pageOne.headers, pageOne.body, pageNo, options);
        const info = asObject(payload.info);
        const rawOrders = asRecordArray(info.data);
        const filtered = filterOrdersAfterSince(rawOrders, options.sinceRequestTime);
        const orders = filtered.orders;
        if (rawOrders.length === 0) break;
        const remaining = options.limit == null ? orders.length : Math.max(0, options.limit - allOrders.length);
        allOrders.push(...(options.limit == null ? orders : orders.slice(0, remaining)));
        if (filtered.shouldStop) break;
        if (rawOrders.length < pageSize) break;
    }

    const rows = [];
    for (const order of allOrders) {
        const aftersalesOrderId = stringValue(order.id || order.aftersalesOrderId);
        if (!aftersalesOrderId) {
            rows.push(...flattenSheinAftersalesOrder(order, {}));
            continue;
        }
        await waitRandomDelay(page);
        const detailPayload = await captureDetailPayload(page, order, options);
        rows.push(...flattenSheinAftersalesOrder(order, asObject(detailPayload.info)));
    }
    return rows;
}

cli({
    site: 'shein',
    name: 'aftersales',
    access: 'read',
    description: '拉取 SHEIN 后台售后订单并按商品摊平',
    example: 'opencli shein aftersales --limit 20 -f json',
    domain: 'sso.geiwohuo.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    defaultFormat: 'json',
    args: [
        { name: 'limit', type: 'int', help: '最多获取的售后订单数量；不传则拉取全部' },
        { name: 'sinceRequestTime', help: '只获取 requestTime 大于该时间的售后单，支持 YYYY-M-D 或 YYYY-M-D HH:mm:ss' },
        { name: 'maxPages', type: 'int', help: '最多拉取页数，调试用' },
        { name: 'timeout', type: 'int', default: 1800, help: '整条 SHEIN 售后命令总超时时间（秒）；全量拉取建议调大' },
        { name: 'requestTimeout', type: 'int', default: 60, help: '单个 SHEIN 页面 API 请求超时时间（秒）' },
        { name: 'retryAttempts', type: 'int', default: 3, help: '页面 API 网络/5xx 失败重试次数' },
        { name: 'retryDelayMs', type: 'int', default: 1000, help: '页面 API 重试基础间隔毫秒；会按尝试次数线性递增' },
    ],
    columns: SHEIN_AFTERSALES_COLUMNS,
    func: collectSheinAftersalesRows,
});

export const __test__ = {
    flattenSheinAftersalesOrder,
    ensureSheinListPage,
    extractListCaptureContext,
    extractDetailFromCapture,
    extractEvidenceFromCapture,
    mergeDetailAndEvidence,
    normalizeRequestTimeInput,
    filterOrdersAfterSince,
    buildPaginatedListBody,
    randomDelayMs,
};
