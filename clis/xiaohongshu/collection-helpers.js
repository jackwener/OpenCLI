import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { buildXhsNoteUrl, normalizeXhsUserId } from './user-helpers.js';

export const COLLECT_API_PATTERN = 'note/collect/page';
export const LIKE_API_PATTERN = 'note/like/page';
export const SAVED_PROFILE_TAB = 'fav';
export const LIKED_PROFILE_TAB = 'liked';

export function buildProfileCollectionUrl(userId, tab) {
    const cleanUserId = toCleanString(userId);
    const cleanTab = toCleanString(tab);
    const url = new URL(`https://www.xiaohongshu.com/user/profile/${cleanUserId}`);
    url.searchParams.set('tab', cleanTab);
    url.searchParams.set('subTab', 'note');
    return url.toString();
}

function toCleanString(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function readSelfUserIdFromState(state) {
    const user = state?.user?.userInfo;
    const info = user?._value ?? user ?? {};
    return toCleanString(info.user_id ?? info.userId ?? info.userID ?? '');
}

export function mapCollectionNote(entry, options = {}) {
    if (!entry || typeof entry !== 'object')
        return null;
    const noteCard = entry.note_card ?? entry.noteCard ?? entry;
    const noteId = toCleanString(entry.note_id
        ?? entry.noteId
        ?? entry.id
        ?? noteCard.note_id
        ?? noteCard.noteId
        ?? noteCard.id);
    if (!noteId)
        return null;
    const user = noteCard.user ?? entry.user ?? {};
    const userId = toCleanString(user.user_id ?? user.userId ?? options.fallbackUserId);
    const xsecToken = toCleanString(entry.xsec_token
        ?? entry.xsecToken
        ?? noteCard.xsec_token
        ?? noteCard.xsecToken);
    const interact = noteCard.interact_info ?? noteCard.interactInfo ?? entry.interact_info ?? entry.interactInfo ?? {};
    const url = buildXhsNoteUrl(userId, noteId, xsecToken)
        || (xsecToken
            ? `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_user`
            : `https://www.xiaohongshu.com/explore/${noteId}`);
    return {
        id: noteId,
        title: toCleanString(noteCard.display_title ?? noteCard.displayTitle ?? noteCard.title ?? entry.title ?? entry.display_title),
        author: toCleanString(user.nickname ?? user.nick_name ?? user.name),
        likes: toCleanString(interact.liked_count ?? interact.likedCount ?? 0) || '0',
        type: toCleanString(noteCard.type ?? entry.type),
        url,
    };
}

export function extractNotesFromResponses(requests, fallbackUserId) {
    const rows = [];
    const seen = new Set();
    for (const req of requests ?? []) {
        const notes = req?.data?.notes ?? req?.data?.note_list ?? [];
        if (!Array.isArray(notes))
            continue;
        for (const entry of notes) {
            const row = mapCollectionNote(entry, { fallbackUserId });
            if (!row?.id || seen.has(row.id))
                continue;
            seen.add(row.id);
            rows.push(row);
        }
    }
    return rows;
}

export const EXTRACT_COLLECTION_DOM_JS = `
  (() => {
    const normalizeUrl = (href) => {
      if (!href) return '';
      if (href.startsWith('http://') || href.startsWith('https://')) return href;
      if (href.startsWith('/')) return 'https://www.xiaohongshu.com' + href;
      return '';
    };
    const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const results = [];
    const seen = new Set();
    document.querySelectorAll('section.note-item').forEach((el) => {
      if (el.classList.contains('query-note-item')) return;
      const titleEl = el.querySelector('.title, .note-title, a.title, .footer .title span');
      const nameEl = el.querySelector('a.author .name, .author-name, .nick-name, .name');
      const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
      const detailLinkEl =
        el.querySelector('a.cover.mask') ||
        el.querySelector('a[href*="/search_result/"]') ||
        el.querySelector('a[href*="/explore/"]') ||
        el.querySelector('a[href*="/note/"]') ||
        el.querySelector('a[href*="/user/profile/"]');
      const url = normalizeUrl(detailLinkEl?.getAttribute('href') || '');
      if (!url) return;
      const noteIdMatch = url.match(/\\/(?:search_result|explore|note)\\/([0-9a-f]{24})|\\/user\\/profile\\/[^/]+\\/([0-9a-f]{24})/i);
      const id = noteIdMatch?.[1] || noteIdMatch?.[2] || '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      results.push({
        id,
        title: cleanText(titleEl?.textContent || ''),
        author: cleanText(nameEl?.textContent || ''),
        likes: cleanText(likesEl?.textContent || '0'),
        type: '',
        url,
      });
    });
    return results;
  })()
`;

async function accumulateInterceptedNotes(page, bucket, fallbackUserId) {
    const reqs = await page.getInterceptedRequests();
    if (Array.isArray(reqs) && reqs.length > 0)
        bucket.push(...reqs);
    return extractNotesFromResponses(bucket, fallbackUserId);
}

export async function resolveXhsUserId(page, rawId) {
    if (rawId)
        return normalizeXhsUserId(String(rawId));
    await page.goto('https://www.xiaohongshu.com/explore');
    await page.wait(2);
    const userId = await page.evaluate(`() => {
      const user = window.__INITIAL_STATE__?.user?.userInfo;
      const info = user?._value ?? user ?? {};
      return info.user_id || info.userId || info.userID || '';
    }`);
    const clean = toCleanString(userId);
    if (!clean) {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Not logged into Xiaohongshu (could not resolve current user id)');
    }
    return clean;
}

export async function extractNotesFromDom(page) {
    const payload = await page.evaluate(EXTRACT_COLLECTION_DOM_JS);
    return Array.isArray(payload) ? payload.filter((item) => item?.id) : [];
}

export async function fetchXhsCollectionNotes(page, {
    userId,
    profileTab,
    apiPattern,
    limit,
    emptyLabel,
}) {
    const capturedRequests = [];
    await page.installInterceptor(apiPattern);
    await page.goto(buildProfileCollectionUrl(userId, profileTab));
    await page.wait(2);
    let notes = [];
    for (let i = 0; i < 16; i++) {
        await page.wait(0.5);
        notes = await accumulateInterceptedNotes(page, capturedRequests, userId);
        if (notes.length > 0)
            break;
    }
    let previousCount = notes.length;
    for (let i = 0; notes.length < limit && i < 4; i += 1) {
        await page.autoScroll({ times: 1, delayMs: 1500 });
        await page.wait(1);
        const nextNotes = await accumulateInterceptedNotes(page, capturedRequests, userId);
        if (nextNotes.length > previousCount) {
            notes = nextNotes;
            previousCount = nextNotes.length;
            continue;
        }
        break;
    }
    if (notes.length === 0) {
        const domNotes = await extractNotesFromDom(page);
        if (domNotes.length > 0)
            notes = domNotes;
    }
    if (notes.length === 0) {
        throw new EmptyResultError('xiaohongshu collection', `No ${emptyLabel} notes found. Ensure you are logged in and this profile tab is visible.`);
    }
    return notes.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        ...item,
    }));
}
