/**
 * Xiaohongshu Creator Note Detail — per-note analytics from the creator detail page.
 *
 * The current creator center no longer serves stable single-note metrics from the legacy
 * `/api/galaxy/creator/data/note_detail` endpoint. The real note detail page loads data
 * through the newer `datacenter/note/*` API family, so this command navigates to the
 * detail page and parses the rendered metrics that are backed by those APIs.
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const NOTE_DETAIL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const NOTE_DETAIL_METRICS = [
    { label: '曝光数', section: '基础数据' },
    { label: '观看数', section: '基础数据' },
    { label: '封面点击率', section: '基础数据' },
    { label: '平均观看时长', section: '基础数据' },
    { label: '涨粉数', section: '基础数据' },
    { label: '点赞数', section: '互动数据' },
    { label: '评论数', section: '互动数据' },
    { label: '收藏数', section: '互动数据' },
    { label: '分享数', section: '互动数据' },
];
const NOTE_DETAIL_METRIC_LABELS = new Set(NOTE_DETAIL_METRICS.map((metric) => metric.label));
const NOTE_DETAIL_SECTIONS = new Set(NOTE_DETAIL_METRICS.map((metric) => metric.section));
const NOTE_DETAIL_NOISE_LINES = new Set([
    '切换笔记',
    '笔记诊断',
    '核心数据',
    '观看来源',
    '观众画像',
    '提升建议',
    '基础数据',
    '互动数据',
    '导出数据',
    '实时',
    '按小时',
    '按天',
]);
function findNoteTitle(lines) {
    const detailIndex = lines.indexOf('笔记数据详情');
    if (detailIndex < 0)
        return '';
    for (let i = detailIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('#') || NOTE_DETAIL_DATETIME_RE.test(line))
            continue;
        if (NOTE_DETAIL_NOISE_LINES.has(line))
            continue;
        return line;
    }
    return '';
}
function findMetricValue(lines, startIndex) {
    let value = '';
    let extra = '';
    for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line)
            continue;
        if (NOTE_DETAIL_METRIC_LABELS.has(line))
            break;
        if (NOTE_DETAIL_NOISE_LINES.has(line) || line.startsWith('数据更新至') || line.startsWith('部分数据统计中'))
            continue;
        if (!value) {
            value = line;
            continue;
        }
        if (!extra && line.startsWith('粉丝')) {
            extra = line;
            break;
        }
        if (line === '0' || /^\d/.test(line) || line.endsWith('%') || line.endsWith('秒')) {
            break;
        }
    }
    return { value, extra };
}
function findPublishedAt(text) {
    const match = text.match(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/);
    return match?.[0] ?? '';
}
export function parseCreatorNoteDetailText(bodyText, noteId) {
    const lines = bodyText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const title = findNoteTitle(lines);
    const publishedAt = lines.find((line) => NOTE_DETAIL_DATETIME_RE.test(line)) ?? '';
    const rows = [
        { section: '笔记信息', metric: 'note_id', value: noteId, extra: '' },
        { section: '笔记信息', metric: 'title', value: title, extra: '' },
        { section: '笔记信息', metric: 'published_at', value: publishedAt, extra: '' },
    ];
    for (const metric of NOTE_DETAIL_METRICS) {
        const index = lines.indexOf(metric.label);
        if (index < 0)
            continue;
        const { value, extra } = findMetricValue(lines, index);
        rows.push({
            section: metric.section,
            metric: metric.label,
            value,
            extra,
        });
    }
    return rows;
}
export function parseCreatorNoteDetailDomData(dom, noteId) {
    if (!dom)
        return [];
    const title = typeof dom.title === 'string' ? dom.title.trim() : '';
    const infoText = typeof dom.infoText === 'string' ? dom.infoText : '';
    const sections = Array.isArray(dom.sections) ? dom.sections : [];
    const rows = [
        { section: '笔记信息', metric: 'note_id', value: noteId, extra: '' },
        { section: '笔记信息', metric: 'title', value: title, extra: '' },
        { section: '笔记信息', metric: 'published_at', value: findPublishedAt(infoText), extra: '' },
    ];
    for (const section of sections) {
        if (!NOTE_DETAIL_SECTIONS.has(section.title))
            continue;
        for (const metric of section.metrics) {
            if (!NOTE_DETAIL_METRIC_LABELS.has(metric.label))
                continue;
            rows.push({
                section: section.title,
                metric: metric.label,
                value: metric.value,
                extra: metric.extra,
            });
        }
    }
    const hasMetric = rows.some((row) => row.section !== '笔记信息' && row.value);
    return hasMetric ? rows : [];
}
function toPercentString(value) {
    return value == null ? '' : `${value}%`;
}
function appendAudienceSourceRows(rows, payload) {
    const sourceItems = payload?.audienceSource?.source ?? [];
    for (const item of sourceItems) {
        if (!item.title)
            continue;
        const extras = [];
        if (item.info?.imp_count != null)
            extras.push(`曝光 ${item.info.imp_count}`);
        if (item.info?.view_count != null)
            extras.push(`观看 ${item.info.view_count}`);
        if (item.info?.interaction_count != null)
            extras.push(`互动 ${item.info.interaction_count}`);
        rows.push({
            section: '观看来源',
            metric: item.title,
            value: toPercentString(item.value_with_double),
            extra: extras.join(' · '),
        });
    }
    return rows;
}
function appendAudiencePortraitGroup(rows, groupLabel, items) {
    for (const item of items ?? []) {
        if (!item.title)
            continue;
        rows.push({
            section: '观众画像',
            metric: `${groupLabel}/${item.title}`,
            value: toPercentString(item.value),
            extra: '',
        });
    }
    return rows;
}
export function appendAudienceRows(rows, payload) {
    appendAudienceSourceRows(rows, payload);
    appendAudiencePortraitGroup(rows, '性别', payload?.audienceSourceDetail?.gender);
    appendAudiencePortraitGroup(rows, '年龄', payload?.audienceSourceDetail?.age);
    appendAudiencePortraitGroup(rows, '城市', payload?.audienceSourceDetail?.city);
    appendAudiencePortraitGroup(rows, '兴趣', payload?.audienceSourceDetail?.interest);
    return rows;
}
function formatTrendTimestamp(ts, granularity) {
    if (!ts)
        return '';
    // Use fixed UTC+8 offset to ensure consistent output regardless of CI server timezone.
    const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
    const cstDate = new Date(ts + CST_OFFSET_MS);
    const pad = (value) => String(value).padStart(2, '0');
    if (granularity === 'hour') {
        return `${pad(cstDate.getUTCMonth() + 1)}-${pad(cstDate.getUTCDate())} ${pad(cstDate.getUTCHours())}:00`;
    }
    return `${cstDate.getUTCFullYear()}-${pad(cstDate.getUTCMonth() + 1)}-${pad(cstDate.getUTCDate())}`;
}
function formatTrendSeries(points, granularity) {
    if (!points?.length)
        return '';
    return points
        .map((point) => {
        const label = formatTrendTimestamp(point.date, granularity);
        const value = point.count_with_double ?? point.count;
        return label && value != null ? `${label}=${value}` : '';
    })
        .filter(Boolean)
        .join(' | ');
}
const TREND_SERIES_CONFIG = [
    { key: 'imp_list', label: '曝光数' },
    { key: 'view_list', label: '观看数' },
    { key: 'view_time_list', label: '平均观看时长' },
    { key: 'like_list', label: '点赞数' },
    { key: 'comment_list', label: '评论数' },
    { key: 'collect_list', label: '收藏数' },
    { key: 'share_list', label: '分享数' },
    { key: 'rise_fans_list', label: '涨粉数' },
];
export function appendTrendRows(rows, payload) {
    if (payload?.audienceTrend?.no_data_tip_msg) {
        rows.push({
            section: '趋势说明',
            metric: '观众趋势',
            value: payload.audienceTrend.no_data ? '暂不可用' : '可用',
            extra: payload.audienceTrend.no_data_tip_msg,
        });
    }
    const buckets = [
        { label: '按小时', granularity: 'hour', data: payload?.noteBase?.hour },
        { label: '按天', granularity: 'day', data: payload?.noteBase?.day },
    ];
    for (const bucket of buckets) {
        for (const series of TREND_SERIES_CONFIG) {
            const points = bucket.data?.[series.key];
            const formatted = formatTrendSeries(points, bucket.granularity);
            if (!formatted)
                continue;
            rows.push({
                section: '趋势数据',
                metric: `${bucket.label}/${series.label}`,
                value: `${points.length} points`,
                extra: formatted,
            });
        }
    }
    return rows;
}
const DETAIL_API_ENDPOINTS = [
    { suffix: '/api/galaxy/creator/datacenter/note/base', key: 'noteBase' },
    { suffix: '/api/galaxy/creator/datacenter/note/analyze/audience/trend', key: 'audienceTrend' },
    { suffix: '/api/galaxy/creator/datacenter/note/audience/source/detail', key: 'audienceSourceDetail' },
    { suffix: '/api/galaxy/creator/datacenter/note/audience/source', key: 'audienceSource' },
];
const CAPTURE_POLL_ATTEMPTS = 20;
const CAPTURE_POLL_INTERVAL_S = 0.5;
function detailApiEndpointForUrl(url) {
    if (!url)
        return null;
    try {
        const parsed = new URL(String(url), 'https://creator.xiaohongshu.com');
        return DETAIL_API_ENDPOINTS.find((endpoint) => parsed.pathname === endpoint.suffix) ?? null;
    }
    catch {
        return null;
    }
}
function findCapturedUrl(captureMap, suffix) {
    return Object.keys(captureMap).find((url) => detailApiEndpointForUrl(url)?.suffix === suffix);
}
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertOptionalArray(payload, key, suffix) {
    if (key in payload && !Array.isArray(payload[key])) {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned malformed ${key}`);
    }
}
function assertOptionalPlainObject(payload, key, suffix) {
    if (key in payload && !isPlainObject(payload[key])) {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned malformed ${key}`);
    }
}
function validateCapturedPayload(payload, endpoint) {
    const suffix = endpoint.suffix;
    if (!isPlainObject(payload)) {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned a malformed payload`);
    }
    if (endpoint.key === 'noteBase') {
        assertOptionalPlainObject(payload, 'hour', suffix);
        assertOptionalPlainObject(payload, 'day', suffix);
    }
    if (endpoint.key === 'audienceSource') {
        assertOptionalArray(payload, 'source', suffix);
    }
    if (endpoint.key === 'audienceSourceDetail') {
        for (const key of ['gender', 'age', 'city', 'interest']) {
            assertOptionalArray(payload, key, suffix);
        }
    }
    return payload;
}
function parseCapturedJson(capture, endpoint) {
    const suffix = endpoint.suffix;
    if (!capture || typeof capture !== 'object') {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: malformed capture for ${suffix}`);
    }
    if (capture.ok !== true) {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned HTTP ${capture.status ?? 'non-2xx'}`);
    }
    if (typeof capture.body !== 'string') {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned a non-text body`);
    }
    try {
        const envelope = JSON.parse(capture.body);
        const payload = isPlainObject(envelope) && Object.hasOwn(envelope, 'data') ? envelope.data : envelope;
        return validateCapturedPayload(payload, endpoint);
    }
    catch {
        throw new CommandExecutionError(`xiaohongshu creator-note-detail: signed API ${suffix} returned invalid JSON or payload shape`);
    }
}
// Capture the dashboard's signed datacenter/note responses on window.__xhsCapture
// since a direct fetch() from page.evaluate bypasses the x-s signing and gets 406.
async function installXhsFetchCaptureHook(page) {
    await page.evaluate(`(() => {
    const targetPaths = ${JSON.stringify(DETAIL_API_ENDPOINTS.map((endpoint) => endpoint.suffix))};
    const shouldCapture = (url) => {
      try {
        return targetPaths.includes(new URL(String(url), window.location.origin).pathname);
      } catch (_) {
        return false;
      }
    };
    // Reset the buffer every call so stale captures from a previous run on
    // the same tab cannot leak into the current navigation's harvest.
    window.__xhsCapture = {};
    if (window.__xhsCaptureInstalled) return;
    window.__xhsCaptureInstalled = true;
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const resp = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (shouldCapture(url)) {
          resp.clone().text().then((body) => {
            try { window.__xhsCapture[url] = { status: resp.status, ok: resp.ok, body }; } catch (_) {}
          }).catch(() => {});
        }
      } catch (_) {}
      return resp;
    };
    const OrigXHR = window.XMLHttpRequest;
    function HookedXHR() {
      const xhr = new OrigXHR();
      const origOpen = xhr.open;
      let capturedUrl = '';
      xhr.open = function(method, url, ...rest) {
        capturedUrl = url;
        return origOpen.call(this, method, url, ...rest);
      };
      xhr.addEventListener('load', () => {
        try {
          if (shouldCapture(capturedUrl)) {
            window.__xhsCapture[capturedUrl] = { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, body: xhr.responseText };
          }
        } catch (_) {}
      });
      return xhr;
    }
    HookedXHR.prototype = OrigXHR.prototype;
    // Preserve readyState constants (UNSENT / OPENED / HEADERS_RECEIVED / LOADING / DONE)
    // since dashboard code may read XMLHttpRequest.DONE etc against the constructor.
    for (const key of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE']) {
      if (key in OrigXHR) HookedXHR[key] = OrigXHR[key];
    }
    window.XMLHttpRequest = HookedXHR;
  })()`);
}
async function captureNoteDetailPayload(page, noteId) {
    await installXhsFetchCaptureHook(page);
    // SPA-navigate inside the dashboard so the React router re-fires the
    // signed datacenter/note/* requests under our hook. A second page.goto
    // would wipe the hook before the first auto-fetch can land.
    await page.evaluate(`(() => {
    const target = '/statistics/note-detail?noteId=' + ${JSON.stringify(noteId)};
    history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  })()`);
    const wantedSuffixes = DETAIL_API_ENDPOINTS.map((endpoint) => endpoint.suffix);
    let captureMap = {};
    for (let i = 0; i < CAPTURE_POLL_ATTEMPTS; i++) {
        await page.wait(CAPTURE_POLL_INTERVAL_S);
        let raw;
        try {
            raw = await page.evaluate('JSON.stringify(window.__xhsCapture || {})');
            captureMap = typeof raw === 'string' ? JSON.parse(raw) : {};
        }
        catch {
            throw new CommandExecutionError('xiaohongshu creator-note-detail: failed to read signed datacenter/note capture buffer');
        }
        if (!captureMap || typeof captureMap !== 'object' || Array.isArray(captureMap)) {
            throw new CommandExecutionError('xiaohongshu creator-note-detail: malformed signed datacenter/note capture buffer');
        }
        const captured = wantedSuffixes.filter((suffix) => findCapturedUrl(captureMap, suffix));
        if (captured.length === wantedSuffixes.length)
            break;
    }
    const payload = {};
    for (const endpoint of DETAIL_API_ENDPOINTS) {
        const matchUrl = findCapturedUrl(captureMap, endpoint.suffix);
        if (!matchUrl)
            continue;
        payload[endpoint.key] = parseCapturedJson(captureMap[matchUrl], endpoint);
    }
    return Object.keys(payload).length > 0 ? payload : null;
}
async function captureNoteDetailDomData(page) {
    const result = await page.evaluate(`() => {
    const norm = (value) => (value || '').trim();
    const sections = Array.from(document.querySelectorAll('.shell-container')).map((container) => {
      const containerText = norm(container.innerText);
      const title = containerText.startsWith('互动数据')
        ? '互动数据'
        : containerText.includes('基础数据')
          ? '基础数据'
          : '';
      const metrics = Array.from(container.querySelectorAll('.block-container.block')).map((block) => ({
        label: norm(block.querySelector('.des')?.innerText),
        value: norm(block.querySelector('.content')?.innerText),
        extra: norm(block.querySelector('.text-with-fans')?.innerText),
      })).filter((metric) => metric.label && metric.value);
      return { title, metrics };
    }).filter((section) => section.title && section.metrics.length > 0);

    return {
      title: norm(document.querySelector('.note-title')?.innerText),
      infoText: norm(document.querySelector('.note-info-content')?.innerText),
      sections,
    };
  }`);
    if (!result || typeof result !== 'object')
        return null;
    return result;
}
export async function fetchCreatorNoteDetailRows(page, noteId) {
    // Land on the dashboard root first so the React app boots before the
    // note-specific signed APIs fire. captureNoteDetailPayload then installs
    // the fetch+XHR hook and SPA-navigates to /statistics/note-detail under
    // it, which is what surfaces the audience / trend rows.
    await page.goto('https://creator.xiaohongshu.com/statistics');
    const apiPayload = await captureNoteDetailPayload(page, noteId);
    const domData = await captureNoteDetailDomData(page).catch(() => null);
    let rows = parseCreatorNoteDetailDomData(domData, noteId);
    if (rows.length === 0) {
        const bodyText = await page.evaluate('() => document.body.innerText');
        rows = parseCreatorNoteDetailText(typeof bodyText === 'string' ? bodyText : '', noteId);
    }
    appendTrendRows(rows, apiPayload ?? undefined);
    appendAudienceRows(rows, apiPayload ?? undefined);
    return rows;
}
cli({
    site: 'xiaohongshu',
    name: 'creator-note-detail',
    access: 'read',
    description: '小红书单篇笔记详情页数据 (笔记信息 + 核心/互动数据 + 观看来源 + 观众画像 + 趋势数据)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'note-id', positional: true, type: 'string', required: true, help: 'Note ID (from creator-notes or note-detail page URL)' },
    ],
    columns: ['section', 'metric', 'value', 'extra'],
    func: async (page, kwargs) => {
        const noteId = kwargs['note-id'];
        const rows = await fetchCreatorNoteDetailRows(page, noteId);
        const hasCoreMetric = rows.some((row) => row.section !== '笔记信息' && row.value);
        if (!hasCoreMetric) {
            throw new EmptyResultError('xiaohongshu creator-note-detail', 'No note detail data found. Check note_id and login status for creator.xiaohongshu.com.');
        }
        return rows;
    },
});
