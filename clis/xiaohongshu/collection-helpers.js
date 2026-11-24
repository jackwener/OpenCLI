import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { PINIA_ACCESS_JS } from './pinia-helpers.js';
import { buildXhsNoteUrl, normalizeXhsUserId } from './user-helpers.js';

export const COLLECT_API_PATTERN = 'note/collect/page';
export const LIKE_API_PATTERN = 'note/like/page';
export const SAVED_PROFILE_TAB = 'fav';
export const LIKED_PROFILE_TAB = 'liked';
const MAX_COLLECTION_LIMIT = 500;

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

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapBrowserResult(payload) {
    if (isObject(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function parseCollectionLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_COLLECTION_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1 || parsed > MAX_COLLECTION_LIMIT) {
        throw new ArgumentError(`--limit must be between 1 and ${MAX_COLLECTION_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

export function readSelfUserIdFromState(state) {
    const unwrapped = unwrapBrowserResult(state);
    const user = unwrapped?.user?.userInfo;
    const info = user?._value ?? user ?? {};
    return toCleanString(info.user_id ?? info.userId ?? info.userID ?? '');
}

export function mapCollectionNote(entry, options = {}) {
    if (!isObject(entry))
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
    const userId = toCleanString(user.user_id ?? user.userId ?? '');
    const xsecToken = toCleanString(entry.xsec_token
        ?? entry.xsecToken
        ?? noteCard.xsec_token
        ?? noteCard.xsecToken);
    if (!xsecToken)
        return null;
    const interact = noteCard.interact_info ?? noteCard.interactInfo ?? entry.interact_info ?? entry.interactInfo ?? {};
    const url = userId
        ? buildXhsNoteUrl(userId, noteId, xsecToken)
        : `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_user`;
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
        const payload = unwrapBrowserResult(req);
        if (!isObject(payload)) {
            throw new CommandExecutionError('xiaohongshu collection API returned a malformed payload');
        }
        const data = payload.data;
        if (!isObject(data)) {
            throw new CommandExecutionError('xiaohongshu collection API returned malformed data');
        }
        const notes = data.notes ?? data.note_list;
        if (!Array.isArray(notes))
            throw new CommandExecutionError('xiaohongshu collection API returned malformed notes');
        for (const entry of notes) {
            const row = mapCollectionNote(entry, { fallbackUserId });
            if (!row?.id || !row.url.includes('xsec_token=')) {
                throw new CommandExecutionError('xiaohongshu collection API returned a note without stable id/xsec token');
            }
            if (seen.has(row.id))
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
      let url;
      try {
        url = new URL(href, 'https://www.xiaohongshu.com');
      } catch {
        return '';
      }
      if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com') return '';
      if (!url.searchParams.get('xsec_token')) return '';
      return url.toString();
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

const LOGIN_WALL_JS = `
  (() => {
    const pathName = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
    const userStore = window.__INITIAL_STATE__?.user;
    const loggedInVal = userStore ? (userStore.loggedIn?._value ?? userStore.loggedIn) : undefined;
    const bodyText = document.body?.innerText || '';
    return Boolean(pathName.indexOf('/login') === 0 || loggedInVal === false || /登录后|请先登录|登录后查看/.test(bodyText));
  })()
`;

const CURRENT_LOCATION_JS = `
  (() => ({
    href: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
  }))()
`;

async function throwIfLoginWall(page) {
    const payload = unwrapBrowserResult(await page.evaluate(LOGIN_WALL_JS));
    if (payload === true) {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu collection page requires login; re-login to xiaohongshu.com and retry.');
    }
}

export async function assertOnCollectionProfile(page, userId) {
    await throwIfLoginWall(page);
    const payload = unwrapBrowserResult(await page.evaluate(CURRENT_LOCATION_JS));
    if (!isObject(payload)) {
        throw new CommandExecutionError('xiaohongshu collection page returned malformed location');
    }
    const hostname = toCleanString(payload.hostname).toLowerCase();
    const pathname = toCleanString(payload.pathname);
    if (hostname === 'www.xiaohongshu.com' && pathname === '/login') {
        throw new AuthRequiredError('xiaohongshu collection page requires login');
    }
    const expectedPath = `/user/profile/${toCleanString(userId)}`;
    if (hostname !== 'www.xiaohongshu.com' || pathname !== expectedPath) {
        throw new CommandExecutionError(`xiaohongshu collection landed on unexpected page: ${toCleanString(payload.href) || `${hostname}${pathname}`}`);
    }
}

async function accumulateInterceptedNotes(page, bucket, fallbackUserId) {
    const reqs = await page.getInterceptedRequests();
    if (!Array.isArray(reqs)) {
        throw new CommandExecutionError('xiaohongshu collection interceptor returned malformed captures');
    }
    if (Array.isArray(reqs) && reqs.length > 0)
        bucket.push(...reqs);
    return extractNotesFromResponses(bucket, fallbackUserId);
}

export async function resolveXhsUserId(page, rawId) {
    if (rawId)
        return normalizeXhsUserId(String(rawId));
    await page.goto('https://www.xiaohongshu.com/explore');
    await page.wait(2);
    await throwIfLoginWall(page);
    const userId = unwrapBrowserResult(await page.evaluate(`() => {
      const user = window.__INITIAL_STATE__?.user?.userInfo;
      const info = user?._value ?? user ?? {};
      return info.user_id || info.userId || info.userID || '';
    }`));
    const clean = toCleanString(userId);
    if (!clean) {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Not logged into Xiaohongshu (could not resolve current user id)');
    }
    return clean;
}

export async function extractNotesFromDom(page) {
    const payload = unwrapBrowserResult(await page.evaluate(EXTRACT_COLLECTION_DOM_JS));
    if (!Array.isArray(payload)) {
        throw new CommandExecutionError('xiaohongshu collection DOM extraction returned malformed rows');
    }
    return payload.filter((item) => item?.id);
}

function readCollectionStoreJs(userId, profileTab, offset) {
    return `
  (async () => {
    ${PINIA_ACCESS_JS}
    const user = __xhsStore('user');
    if (__xhsLoggedOut()) return { error: 'login' };
    if (location.hostname !== 'www.xiaohongshu.com' ||
        location.pathname !== ${JSON.stringify(`/user/profile/${userId}`)}) return { error: 'profile' };
    const tab = ${JSON.stringify(profileTab)};
    const liked = tab === '${LIKED_PROFILE_TAB}';
    if (typeof user?.fetchNotes !== 'function' || user.activeTab?.query !== tab ||
        (!liked && user.activeSubTab?.query !== 'note')) return null;
    const index = liked ? user.activeTab.index : user.activeSubTab.index;
    const offset = ${JSON.stringify(offset)};
    if (!Array.isArray(user.notes?.[index]) || typeof user.noteQueries?.[index]?.hasMore !== 'boolean') return null;

    let error;
    if (offset !== null && user.noteQueries[index].hasMore && user.notes[index].length >= offset) {
      if (user.userNoteFetchingStatus?.[index] === 'pending') return { pending: true };
      try {
        await user.fetchNotes(index);
      } catch (err) {
        const status = Number(err?.response?.status ?? err?.status ?? err?.code);
        error = status === 429 || status === 461 ? 'security' : 'request';
      }
      if (__xhsLoggedOut()) return { error: 'login' };
      if (user.userNoteFetchingStatus?.[index] === 'rejected') error ??= 'request';
    }
    const notes = user.notes?.[index];
    const query = user.noteQueries?.[index];
    if (!Array.isArray(notes) || typeof query?.hasMore !== 'boolean') return error ? { error } : null;
    return {
      notes: __xhsClone(notes.slice(offset ?? 0)), count: notes.length,
      cursor: query.cursor, page: query.page, hasMore: query.hasMore, error,
    };
  })()
`;
}

async function fetchCollectionFromStore(page, userId, profileTab, limit) {
    const readStore = async (offset) => {
        const script = readCollectionStoreJs(userId, profileTab, offset);
        for (let i = 0; i < 8; i += 1) {
            const state = unwrapBrowserResult(await page.evaluate(script));
            if (!state?.pending && (state !== null || offset !== null)) return state;
            // Let the tab hydrate and any page-initiated fetch finish.
            await page.wait(0.25);
        }
        return null;
    };
    let state = await readStore(null);
    if (state === null) return null;

    const rows = new Map();
    let previous;
    while (state !== null) {
        if (state.error === 'login') {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu collection page requires login; re-login to xiaohongshu.com and retry.');
        }
        if (state.error === 'profile') {
            throw new CommandExecutionError('Xiaohongshu left the requested collection profile while paginating.');
        }
        if ('notes' in state) {
            for (const row of extractNotesFromResponses([{ data: { notes: state.notes } }], userId)) {
                if (!rows.has(row.id)) rows.set(row.id, row);
            }
        }
        if (state.error === 'security') {
            if (rows.size > 0) break;
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu collection was blocked by risk control.', 'Wait before retrying.');
        }
        if (state.error === 'request') {
            throw new CommandExecutionError('Xiaohongshu collection page failed to load more notes.');
        }
        if (rows.size >= limit || !state.hasMore || (previous && (state.count < previous.count ||
            (state.cursor === previous.cursor && state.page === previous.page)))) break;

        previous = state;
        await page.wait(0.65);
        state = await readStore(previous.count);
    }
    return state === null && rows.size === 0 ? null : [...rows.values()];
}

const SCROLL_COLLECTION_JS = `
  (() => {
    const container = document.querySelector('#userPageContainer');
    if (!container) return false;
    container.scrollTop = container.scrollHeight;
    return true;
  })()
`;

async function fetchCollectionFromPage(page, userId, apiPattern, limit) {
    const capturedRequests = [];
    await page.installInterceptor(apiPattern);
    const notes = new Map();
    const readNotes = async () => {
        // The first page can already be rendered before the interceptor is installed.
        const dom = await extractNotesFromDom(page);
        for (const row of dom) {
            if (!notes.has(row.id)) notes.set(row.id, row);
        }
        for (const row of await accumulateInterceptedNotes(page, capturedRequests, userId)) {
            notes.set(row.id, row);
        }
    };
    for (let i = 0; i < 16; i++) {
        await readNotes();
        if (notes.size > 0) break;
        await page.wait(0.5);
    }
    for (let i = 0; notes.size < limit && i < 4; i += 1) {
        const previousCount = notes.size;
        if (unwrapBrowserResult(await page.evaluate(SCROLL_COLLECTION_JS))) {
            await page.wait({ time: 1.5 });
        } else {
            await page.autoScroll({ times: 1, delayMs: 1500 });
        }
        await page.wait(1);
        await assertOnCollectionProfile(page, userId);
        await readNotes();
        if (notes.size === previousCount) break;
    }
    return [...notes.values()];
}

export async function fetchXhsCollectionNotes(page, {
    userId,
    profileTab,
    apiPattern,
    limit,
    emptyLabel,
}) {
    await page.goto(buildProfileCollectionUrl(userId, profileTab));
    await page.wait(2);
    await assertOnCollectionProfile(page, userId);
    const notes = await fetchCollectionFromStore(page, userId, profileTab, limit)
        ?? await fetchCollectionFromPage(page, userId, apiPattern, limit);
    if (notes.length === 0) {
        throw new EmptyResultError('xiaohongshu collection', `No ${emptyLabel} notes found. Ensure you are logged in and this profile tab is visible.`);
    }
    return notes.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        ...item,
    }));
}
