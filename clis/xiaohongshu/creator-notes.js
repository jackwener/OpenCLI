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
const DATE_LINE_RE = /^发布于 (\d{4}年\d{2}月\d{2}日 \d{2}:\d{2})$/;
const METRIC_LINE_RE = /^\d+$/;
const VISIBILITY_LINE_RE = /可见$/;
const NOTE_ANALYZE_API_PATH = '/api/galaxy/creator/datacenter/note/analyze/list';
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
    let notes = await fetchCreatorNotesByApi(page, limit);
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
            throw new Error('No notes found. Are you logged into creator.xiaohongshu.com?');
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
