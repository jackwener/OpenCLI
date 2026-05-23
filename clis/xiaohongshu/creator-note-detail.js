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
import { EmptyResultError } from '@jackwener/opencli/errors';
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
// Install a fetch + XHR capture hook on window.__xhsCapture so the
// dashboard's own signed requests (x-s / x-t / x-s-common) land in our
// observation buffer. A direct fetch() from page.evaluate bypasses the
// signing interceptor and returns HTTP 406, so prior to this the four
// datacenter/note/* calls silently surfaced no rows.
async function installXhsFetchCaptureHook(page) {
    await page.evaluate(`(() => {
    if (window.__xhsCapture) return;
    window.__xhsCapture = {};
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const resp = await origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (url.includes('/api/galaxy/')) {
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
          if (capturedUrl.includes('/api/galaxy/')) {
            window.__xhsCapture[capturedUrl] = { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, body: xhr.responseText };
          }
        } catch (_) {}
      });
      return xhr;
    }
    HookedXHR.prototype = OrigXHR.prototype;
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
    // 20 iterations × 0.5s wait = 10s upper bound; the iteration cap also
    // keeps the loop terminating quickly under a no-op page.wait mock.
    let captureMap = {};
    for (let i = 0; i < 20; i++) {
        await page.wait(0.5);
        const raw = await page.evaluate('JSON.stringify(window.__xhsCapture || {})');
        captureMap = typeof raw === 'string' ? JSON.parse(raw) : {};
        const captured = wantedSuffixes.filter((suffix) => Object.keys(captureMap).some((url) => url.includes(suffix)));
        if (captured.length === wantedSuffixes.length)
            break;
    }
    const payload = {};
    for (const { suffix, key } of DETAIL_API_ENDPOINTS) {
        const matchUrl = Object.keys(captureMap).find((url) => url.includes(suffix));
        if (!matchUrl)
            continue;
        const capture = captureMap[matchUrl];
        if (!capture || !capture.ok)
            continue;
        try {
            const json = JSON.parse(capture.body);
            payload[key] = json.data ?? json;
        }
        catch { }
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
    const apiPayload = await captureNoteDetailPayload(page, noteId).catch(() => null);
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
