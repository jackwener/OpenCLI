/**
 * Xiaohongshu Creator Note List — per-note metrics from the creator backend.
 *
 * In CDP mode we capture the real creator analytics API response so the list
 * includes stable note ids and detail-page URLs. If that capture is unavailable,
 * we fall back to the older interceptor and DOM parsing paths.
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const DATE_LINE_RE = /^发布于 (\d{4}年\d{2}月\d{2}日 \d{2}:\d{2})$/;
const METRIC_LINE_RE = /^\d+$/;
const VISIBILITY_LINE_RE = /可见$/;
const NOTE_ANALYZE_API_PATH = '/api/galaxy/creator/datacenter/note/analyze/list';
const NOTE_ANALYZE_PAGE_SIZE = 10;
const CAPTURE_POLL_ATTEMPTS = 20;
const CAPTURE_POLL_INTERVAL_S = 0.5;
const NOTE_DETAIL_PAGE_URL = 'https://creator.xiaohongshu.com/statistics/note-detail';
const NOTE_ID_HTML_RE = /&quot;noteId&quot;:&quot;([0-9a-f]{24})&quot;/g;
function buildNoteDetailUrl(noteId) {
    return noteId ? `${NOTE_DETAIL_PAGE_URL}?noteId=${encodeURIComponent(noteId)}` : '';
}
function formatPostTime(ts) {
    if (!ts)
        return '';
    // XHS API timestamps are Beijing time (UTC+8)
    const date = new Date(ts + 8 * 3600_000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}年${pad(date.getUTCMonth() + 1)}月${pad(date.getUTCDate())}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
export function parseCreatorNotesText(bodyText) {
    const lines = bodyText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const results = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
        const dateMatch = lines[i].match(DATE_LINE_RE);
        if (!dateMatch)
            continue;
        let titleIndex = i - 1;
        while (titleIndex >= 0 && VISIBILITY_LINE_RE.test(lines[titleIndex]))
            titleIndex--;
        if (titleIndex < 0)
            continue;
        const title = lines[titleIndex];
        const metrics = [];
        let cursor = i + 1;
        while (cursor < lines.length && METRIC_LINE_RE.test(lines[cursor]) && metrics.length < 5) {
            metrics.push(parseInt(lines[cursor], 10));
            cursor++;
        }
        if (metrics.length < 4)
            continue;
        const key = `${title}@@${dateMatch[1]}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        results.push({
            id: '',
            title,
            date: dateMatch[1],
            views: metrics[0] ?? 0,
            likes: metrics[2] ?? 0,
            collects: metrics[3] ?? 0,
            comments: metrics[1] ?? 0,
            url: '',
        });
        i = cursor - 1;
    }
    return results;
}
export function parseCreatorNoteIdsFromHtml(bodyHtml) {
    const ids = [];
    const seen = new Set();
    for (const match of bodyHtml.matchAll(NOTE_ID_HTML_RE)) {
        const id = match[1];
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
function mapDomCards(cards) {
    return cards.map((card) => ({
        id: card.id,
        title: card.title,
        date: card.date,
        views: card.metrics[0] ?? 0,
        likes: card.metrics[2] ?? 0,
        collects: card.metrics[3] ?? 0,
        comments: card.metrics[1] ?? 0,
        url: buildNoteDetailUrl(card.id),
    }));
}
function mapAnalyzeItems(items) {
    return (items ?? []).map((item) => ({
        id: item.id ?? '',
        title: item.title ?? '',
        date: formatPostTime(item.post_time),
        views: item.read_count ?? 0,
        likes: item.like_count ?? 0,
        collects: item.fav_count ?? 0,
        comments: item.comment_count ?? 0,
        url: buildNoteDetailUrl(item.id),
    }));
}
function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
// Capture the dashboard's signed /api/galaxy/* responses on window.__xhsCapture
// since a direct fetch() from page.evaluate bypasses the x-s signing and gets 406.
async function installXhsFetchCaptureHook(page) {
    await page.evaluate(`(() => {
    window.__xhsCapture = {};
    if (window.__xhsCaptureInstalled) return;
    window.__xhsCaptureInstalled = true;
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
    for (const key of ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE']) {
      if (key in OrigXHR) HookedXHR[key] = OrigXHR[key];
    }
    window.XMLHttpRequest = HookedXHR;
  })()`);
}
function parseCaptureMapPayload(raw) {
    const payload = unwrapEvaluateResult(raw);
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload);
        }
        catch {
            return {};
        }
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return payload;
    }
    return {};
}
function getAnalyzeListPageNumber(url) {
    try {
        const parsed = new URL(url, 'https://creator.xiaohongshu.com');
        const pageNum = Number.parseInt(parsed.searchParams.get('page_num') || '', 10);
        if (Number.isFinite(pageNum) && pageNum > 0)
            return pageNum;
    }
    catch { }
    const match = String(url || '').match(/[?&]page_num=(\d+)/);
    const pageNum = Number.parseInt(match?.[1] || '', 10);
    return Number.isFinite(pageNum) && pageNum > 0 ? pageNum : Number.MAX_SAFE_INTEGER;
}
function harvestAnalyzeListCaptures(captureMap) {
    const items = [];
    const seen = new Set();
    let total = 0;
    const entries = Object.entries(captureMap)
        .filter(([url]) => url.includes('/note/analyze/list'))
        .sort(([a], [b]) => getAnalyzeListPageNumber(a) - getAnalyzeListPageNumber(b));
    for (const [url, capture] of entries) {
        if (!capture?.ok) continue;
        try {
            const json = JSON.parse(capture.body);
            const data = json?.data ?? {};
            if (typeof data.total === 'number' && data.total > total) total = data.total;
            for (const note of data.note_infos ?? []) {
                if (!note?.id || seen.has(note.id)) continue;
                seen.add(note.id);
                items.push(note);
            }
        }
        catch { }
    }
    return { items, total };
}
function isAnalyzeCaptureComplete(items, total, limit) {
    if (total <= 0)
        return true;
    return items.length >= Math.min(total, limit);
}
async function pollCaptureMap(page) {
    let captureMap = {};
    for (let i = 0; i < CAPTURE_POLL_ATTEMPTS; i++) {
        await page.wait(CAPTURE_POLL_INTERVAL_S);
        const raw = await page.evaluate('JSON.stringify(window.__xhsCapture || {})');
        captureMap = parseCaptureMapPayload(raw);
        if (Object.keys(captureMap).some((url) => url.includes('/note/analyze/list'))) break;
    }
    return captureMap;
}
// Fresh-published notes return title: "" from /note/analyze/list. Scrape the
// /new/note-manager card DOM (under its "全部笔记" tab, which surfaces every
// state including 审核中) so the rows the API leaves empty still get the
// derived title that the note-manager UI shows.
async function fetchNoteManagerTitleMap(page, neededCount) {
    const map = new Map();
    const scrapeCards = async () => {
        const cards = unwrapEvaluateResult(await page.evaluate(`() => {
      const noteIdRe = /"noteId":"([0-9a-f]{24})"/;
      return Array.from(document.querySelectorAll('div.note[data-impression], div.note')).map((card) => {
        const impression = card.getAttribute('data-impression') || '';
        const id = impression.match(noteIdRe)?.[1] || '';
        const title = (card.querySelector('.title, .raw')?.innerText || '').trim();
        return { id, title };
      }).filter((entry) => entry.id && entry.title);
    }`));
        for (const card of Array.isArray(cards) ? cards : []) {
            if (!map.has(card.id)) map.set(card.id, card.title);
        }
    };
    // Scroll the first scrollable ancestor of a note card to the bottom so
    // the list lazy-loads the rest of its rows. Page-level scrollTo does not
    // work because the cards live inside an inner overflow-auto container.
    const scrollInnerListToBottom = async () => {
        return unwrapEvaluateResult(await page.evaluate(`(() => {
      const firstCard = document.querySelector('div.note[data-impression]');
      let el = firstCard && firstCard.parentElement;
      while (el) {
        const s = window.getComputedStyle(el);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
          el.scrollTop = el.scrollHeight;
          return true;
        }
        el = el.parentElement;
      }
      return false;
    })()`));
    };
    try {
        await page.goto('https://creator.xiaohongshu.com/new/note-manager');
        // Poll for the initial hydration batch and then scroll the inner list
        // container to surface the rest of the rows. The all-notes tab is the
        // default state so no tab click is needed here.
        for (let i = 0; i < 12; i++) {
            await page.wait(1);
            await scrapeCards();
            if (map.size >= neededCount) return map;
            await scrollInnerListToBottom();
        }
        return map;
    }
    catch {
        return map;
    }
}
async function fetchCreatorNotesByCapture(page, limit) {
    // Land on dashboard root before installing the hook so the data-analysis
    // SPA navigation fires page_num=1's signed request UNDER the hook.
    await page.goto('https://creator.xiaohongshu.com/statistics');
    await installXhsFetchCaptureHook(page);
    await page.evaluate(`(() => {
    history.pushState({}, '', '/statistics/data-analysis?source=official');
    window.dispatchEvent(new PopStateEvent('popstate'));
  })()`);
    let captureMap = await pollCaptureMap(page);
    let { items, total } = harvestAnalyzeListCaptures(captureMap);
    if (items.length === 0) return [];
    const totalPages = total > 0 ? Math.ceil(total / NOTE_ANALYZE_PAGE_SIZE) : 1;
    const neededPages = Math.min(totalPages, Math.ceil(limit / NOTE_ANALYZE_PAGE_SIZE));
    for (let pageNum = 2; pageNum <= neededPages && items.length < limit; pageNum++) {
        const clicked = unwrapEvaluateResult(await page.evaluate(`(() => {
      const target = String(${pageNum});
      // .d-pagination-page renders the page number doubled (a visible span +
      // an accessibility span), so textContent for page 2 reads "22". Match
      // both the raw digit and the doubled form to tolerate either render.
      const btns = Array.from(document.querySelectorAll('.d-pagination-page'));
      const match = btns.find((btn) => {
        const text = (btn.textContent || '').trim();
        return text === target || text === target + target;
      });
      if (match) { match.click(); return true; }
      return false;
    })()`));
        if (!clicked) break;
        const before = items.length;
        let advanced = false;
        for (let attempt = 0; attempt < CAPTURE_POLL_ATTEMPTS; attempt++) {
            await page.wait(CAPTURE_POLL_INTERVAL_S);
            const raw = await page.evaluate('JSON.stringify(window.__xhsCapture || {})');
            captureMap = parseCaptureMapPayload(raw);
            const harvested = harvestAnalyzeListCaptures(captureMap);
            if (harvested.items.length > before) {
                items = harvested.items;
                total = Math.max(total, harvested.total);
                advanced = true;
                break;
            }
        }
        if (!advanced) break;
    }
    if (!isAnalyzeCaptureComplete(items, total, limit)) {
        throw new CommandExecutionError(`xiaohongshu creator-notes: captured ${items.length} of ${Math.min(total, limit)} expected analyze rows; refusing partial results`);
    }
    const notes = mapAnalyzeItems(items).slice(0, limit);
    const missingTitles = notes.filter((note) => !note.title).length;
    if (missingTitles > 0) {
        const titleMap = await fetchNoteManagerTitleMap(page, notes.length);
        for (const note of notes) {
            if (!note.title && note.id && titleMap.has(note.id)) {
                note.title = titleMap.get(note.id);
            }
        }
    }
    return notes;
}
async function fetchCreatorNotesByApi(page, limit) {
    const pageSize = Math.min(Math.max(limit, 10), 20);
    const maxPages = Math.max(1, Math.ceil(limit / pageSize));
    const notes = [];
    await page.goto(`https://creator.xiaohongshu.com/statistics/data-analysis?type=0&page_size=${pageSize}&page_num=1`);
    for (let pageNum = 1; pageNum <= maxPages && notes.length < limit; pageNum++) {
        const apiPath = `${NOTE_ANALYZE_API_PATH}?type=0&page_size=${pageSize}&page_num=${pageNum}`;
        const fetched = await page.evaluate(`
      async () => {
        try {
          const resp = await fetch(${JSON.stringify(apiPath)}, { credentials: 'include' });
          if (!resp.ok) return { error: 'HTTP ' + resp.status };
          return await resp.json();
        } catch (e) {
          return { error: e?.message ?? String(e) };
        }
      }
    `);
        let items = fetched?.data?.note_infos ?? [];
        if (!items.length) {
            await page.installInterceptor(NOTE_ANALYZE_API_PATH);
            await page.evaluate(`
        async () => {
          try {
            await fetch(${JSON.stringify(apiPath)}, { credentials: 'include' });
          } catch {}
          return true;
        }
      `);
            await page.wait(1);
            const intercepted = await page.getInterceptedRequests();
            const data = intercepted.find((entry) => Array.isArray(entry?.data?.note_infos));
            items = data?.data?.note_infos ?? [];
        }
        if (!items.length)
            break;
        notes.push(...mapAnalyzeItems(items));
        if (items.length < pageSize)
            break;
    }
    return notes.slice(0, limit);
}
export async function fetchCreatorNotes(page, limit) {
    let notes = [];
    try {
        notes = await fetchCreatorNotesByCapture(page, limit);
    }
    catch (error) {
        if (error instanceof CommandExecutionError) throw error;
    }
    if (notes.length === 0) {
        notes = await fetchCreatorNotesByApi(page, limit);
    }
    if (notes.length === 0) {
        await page.goto('https://creator.xiaohongshu.com/new/note-manager');
        const maxPageDowns = Math.max(0, Math.ceil(limit / 10) + 1);
        for (let i = 0; i <= maxPageDowns; i++) {
            const domCards = await page.evaluate(`() => {
        const noteIdRe = /"noteId":"([0-9a-f]{24})"/;
        return Array.from(document.querySelectorAll('div.note[data-impression], div.note')).map((card) => {
          const impression = card.getAttribute('data-impression') || '';
          const id = impression.match(noteIdRe)?.[1] || '';
          const title = (card.querySelector('.title, .raw')?.innerText || '').trim();
          const dateText = (card.querySelector('.time_status, .time')?.innerText || '').trim();
          const date = dateText.replace(/^发布于\\s*/, '');
          const metrics = Array.from(card.querySelectorAll('.icon_list .icon'))
            .map((el) => parseInt((el.innerText || '').trim(), 10))
            .filter((value) => Number.isFinite(value));
          return { id, title, date, metrics };
        });
      }`);
            const parsedDomNotes = mapDomCards(Array.isArray(domCards) ? domCards : []).filter((note) => note.title && note.date);
            if (parsedDomNotes.length > 0) {
                notes = parsedDomNotes;
            }
            if (notes.length >= limit || (notes.length > 0 && i === 0))
                break;
            const body = await page.evaluate('() => ({ text: document.body.innerText, html: document.body.innerHTML })');
            const bodyText = typeof body?.text === 'string' ? body.text : '';
            const bodyHtml = typeof body?.html === 'string' ? body.html : '';
            const parsedNotes = parseCreatorNotesText(bodyText);
            const noteIds = parseCreatorNoteIdsFromHtml(bodyHtml);
            notes = parsedNotes.map((note, index) => {
                const id = noteIds[index] ?? '';
                return {
                    ...note,
                    id,
                    url: buildNoteDetailUrl(id),
                };
            });
            if (notes.length >= limit || i === maxPageDowns)
                break;
            await page.pressKey('PageDown');
            await page.wait(1);
        }
    }
    return notes.slice(0, limit);
}
cli({
    site: 'xiaohongshu',
    name: 'creator-notes',
    access: 'read',
    description: '小红书创作者笔记列表 + 每篇数据 (标题/日期/观看/点赞/收藏/评论)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of notes to return' },
    ],
    columns: ['rank', 'id', 'title', 'date', 'views', 'likes', 'collects', 'comments', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        const notes = await fetchCreatorNotes(page, limit);
        if (!Array.isArray(notes) || notes.length === 0) {
            throw new EmptyResultError('xiaohongshu creator-notes', 'No notes found. Ensure you are logged into creator.xiaohongshu.com and the account has published notes.');
        }
        return notes
            .slice(0, limit)
            .map((n, i) => ({
            rank: i + 1,
            id: n.id,
            title: n.title,
            date: n.date,
            views: n.views,
            likes: n.likes,
            collects: n.collects,
            comments: n.comments,
            url: n.url,
        }));
    },
});
export const __test__ = {
    harvestAnalyzeListCaptures,
    isAnalyzeCaptureComplete,
    parseCaptureMapPayload,
    unwrapEvaluateResult,
};
