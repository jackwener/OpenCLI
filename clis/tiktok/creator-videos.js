import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    getErrorMessage,
} from '@jackwener/opencli/errors';

const STUDIO_CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content';
const ITEM_LIST_API_PATH = '/tiktok/creator/manage/item_list/v1/';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 250;
const SERVER_PAGE_MAX = 50;

function requirePositiveInt(value, label, defaultValue, maxValue) {
    const raw = value ?? defaultValue;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`, `Example: opencli tiktok creator-videos --${label} ${defaultValue}`);
    }
    if (parsed > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`, `Example: opencli tiktok creator-videos --${label} ${maxValue}`);
    }
    return parsed;
}

function requireCursor(value) {
    const raw = value ?? '0';
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) {
        throw new ArgumentError('cursor must be a non-negative integer string', 'Example: opencli tiktok creator-videos --cursor 0');
    }
    const cursor = Number(text);
    if (!Number.isSafeInteger(cursor)) {
        throw new ArgumentError('cursor must be a safe integer', 'Example: opencli tiktok creator-videos --cursor 0');
    }
    return cursor;
}

function buildItemListRequest(cursor, size) {
    return {
        cursor,
        size,
        query: {
            conditions: [],
            sort_orders: [{ field_name: 'create_time', order: 2 }],
        },
    };
}

function buildFetchItemListScript(body) {
    const request = {
        url: `${ITEM_LIST_API_PATH}?aid=1988`,
        body,
    };
    return `
(async () => {
  const request = ${JSON.stringify(request)};
  try {
    const res = await fetch(request.url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.body),
    });
    const text = await res.text();
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        return {
          ok: false,
          status: res.status,
          statusText: res.statusText,
          parseError: error instanceof Error ? error.message : String(error),
          text: text.slice(0, 500),
        };
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      data,
      text: text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      networkError: error instanceof Error ? error.message : String(error),
    };
  }
})()
`;
}

function looksAuthFailure(message) {
    return /\b(auth|login|log in|permission|unauthori[sz]ed|forbidden)\b/i.test(message);
}

function unwrapPayload(data) {
    if (!data || typeof data !== 'object') {
        throw new CommandExecutionError('TikTok Studio item_list returned an empty response');
    }
    return data.data && typeof data.data === 'object' ? data.data : data;
}

function assertApiSuccess(data) {
    const statusCode = data.status_code ?? data.statusCode;
    const statusMsg = String(data.status_msg ?? data.statusMsg ?? '').trim();
    if (statusCode !== undefined && Number(statusCode) !== 0) {
        if (looksAuthFailure(statusMsg)) {
            throw new AuthRequiredError('www.tiktok.com', `TikTok Studio item_list requires login: ${statusMsg || statusCode}`);
        }
        throw new CommandExecutionError(`TikTok Studio item_list failed: ${statusMsg || statusCode}`);
    }
    if (statusMsg && !/^(success|ok)$/i.test(statusMsg)) {
        if (looksAuthFailure(statusMsg)) {
            throw new AuthRequiredError('www.tiktok.com', `TikTok Studio item_list requires login: ${statusMsg}`);
        }
        throw new CommandExecutionError(`TikTok Studio item_list failed: ${statusMsg}`);
    }
}

function normalizeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    return new Date(seconds * 1000).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
    });
}

function extractUsername(item) {
    const direct = item.author?.unique_id ?? item.author?.uniqueId ?? item.author_unique_id ?? item.authorUniqueId ?? item.user_name ?? item.username;
    if (direct) return String(direct);

    const blobs = [
        ...(Array.isArray(item.play_addr) ? item.play_addr : []),
        ...(item.download_info && Array.isArray(item.download_info.download_urls) ? item.download_info.download_urls : []),
    ];
    for (const raw of blobs) {
        try {
            const match = String(raw).match(/[?&]user_text=([^&]+)/);
            if (match) return decodeURIComponent(match[1]);
        } catch {
            // Keep scanning other candidate URLs.
        }
    }
    return '';
}

function normalizeRow(item) {
    if (!item || typeof item !== 'object') return null;
    const videoId = String(item.item_id ?? item.id ?? '').trim();
    if (!videoId) return null;
    const username = extractUsername(item);
    const url = username
        ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(videoId)}`
        : '';
    return {
        video_id: videoId,
        title: String(item.desc ?? item.title ?? '').replace(/\s+/g, ' ').trim(),
        date: formatDate(item.post_time ?? item.create_time ?? item.schedule_time),
        views: normalizeNumber(item.play_count),
        likes: normalizeNumber(item.like_count),
        comments: normalizeNumber(item.comment_count),
        saves: normalizeNumber(item.favorite_count),
        shares: normalizeNumber(item.share_count),
        url,
    };
}

async function fetchCreatorVideosPage(page, cursor, size) {
    const result = await page.evaluate(buildFetchItemListScript(buildItemListRequest(cursor, size))).catch((error) => {
        throw new CommandExecutionError(`Failed to fetch TikTok Studio item_list: ${getErrorMessage(error)}`);
    });
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError('TikTok Studio item_list returned an unreadable response');
    }
    if (result.networkError) {
        throw new CommandExecutionError(`TikTok Studio item_list network failure: ${result.networkError}`);
    }
    if (result.status === 401 || result.status === 403) {
        throw new AuthRequiredError('www.tiktok.com', `TikTok Studio item_list requires login (HTTP ${result.status})`);
    }
    if (!result.ok) {
        const detail = result.parseError
            ? `invalid JSON (${result.parseError})`
            : `HTTP ${result.status || 0}${result.statusText ? ` ${result.statusText}` : ''}`;
        throw new CommandExecutionError(`TikTok Studio item_list failed: ${detail}`, result.text ? `Response preview: ${result.text}` : undefined);
    }
    const payload = unwrapPayload(result.data);
    assertApiSuccess(payload);
    return payload;
}

async function listCreatorVideos(page, args) {
    const limit = requirePositiveInt(args.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT);
    let nextCursor = requireCursor(args.cursor);
    const rows = [];
    let skippedMissingId = 0;
    const pageSize = limit > SERVER_PAGE_MAX ? SERVER_PAGE_MAX : limit;
    const maxPages = Math.ceil(limit / pageSize);

    await page.goto(STUDIO_CONTENT_URL, { waitUntil: 'load', settleMs: 6000 });

    for (let pageIndex = 0; pageIndex < maxPages && rows.length < limit; pageIndex += 1) {
        const data = await fetchCreatorVideosPage(page, nextCursor, pageSize);
        const items = Array.isArray(data.item_list) ? data.item_list : [];
        for (const item of items) {
            const row = normalizeRow(item);
            if (!row) {
                skippedMissingId += 1;
                continue;
            }
            rows.push(row);
            if (rows.length >= limit) break;
        }
        if (!data.has_more || items.length === 0) break;
        nextCursor = requireCursor(data.cursor);
        await page.wait(250);
    }

    if (rows.length === 0 && skippedMissingId > 0) {
        throw new CommandExecutionError('TikTok Studio item_list returned videos without stable video_id');
    }
    if (rows.length === 0) {
        throw new EmptyResultError('tiktok creator-videos', 'No creator videos were returned. Confirm the current Chrome profile is logged in to TikTok Studio and has published content.');
    }
    return rows.slice(0, limit);
}

export const creatorVideosCommand = cli({
    site: 'tiktok',
    name: 'creator-videos',
    access: 'read',
    description: 'TikTok Studio creator content list (views/likes/comments/saves/shares)',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: STUDIO_CONTENT_URL,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of creator videos to return (max ${MAX_LIMIT})` },
        { name: 'cursor', type: 'string', default: '0', help: 'Non-negative TikTok Studio pagination cursor' },
    ],
    columns: ['video_id', 'title', 'date', 'views', 'likes', 'comments', 'saves', 'shares', 'url'],
    func: listCreatorVideos,
});

export const __test__ = {
    buildFetchItemListScript,
    buildItemListRequest,
    extractUsername,
    normalizeRow,
    requireCursor,
    requirePositiveInt,
};
