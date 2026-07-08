// Shared TikTok adapter helpers.
//
// - Node-side: input validation (typed errors per OpenCLI rules).
// - Browser-side: a string template embedded into each `page.evaluate(...)` IIFE so
//   the helpers run alongside the adapter-specific logic in the live page context.
//   This keeps `findUniversalData / fetchJson / cleanText / asNumber / getCookie`
//   identical across adapters without depending on a shared script being injected
//   beforehand.

import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    getErrorMessage,
} from '@jackwener/opencli/errors';

export const TIKTOK_AID = '1988';
export const TIKTOK_HOST = 'https://www.tiktok.com';
export const SERVER_PAGE_MAX = 30;
export const MAX_PAGES = 4;

export function requireLimit(value, { fallback, max, name = 'limit' }) {
    const raw = value ?? fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ArgumentError(
            `${name} must be a positive integer`,
            `Example: --${name} ${fallback}`,
        );
    }
    if (parsed > max) {
        throw new ArgumentError(
            `${name} must be <= ${max}`,
            `Example: --${name} ${max}`,
        );
    }
    return parsed;
}

export function normalizeUsername(value) {
    const username = String(value ?? '').trim().replace(/^@+/, '');
    if (!username) {
        throw new ArgumentError(
            'username is required',
            'Example: opencli tiktok following <username>',
        );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(username)) {
        throw new ArgumentError(
            'username contains unsupported characters',
            'Pass the TikTok handle without @, for example: dictogo',
        );
    }
    return username;
}

export const NOTIFICATION_TYPES = {
    all: { code: 0, label: 'all' },
    likes: { code: 3, label: 'likes' },
    comments: { code: 7, label: 'comments' },
    mentions: { code: 6, label: 'mentions' },
    followers: { code: 4, label: 'followers' },
};

export function requireNotificationType(value) {
    const key = String(value ?? 'all').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, key)) {
        throw new ArgumentError(
            `unsupported notification type: ${value}`,
            `Allowed: ${Object.keys(NOTIFICATION_TYPES).join(', ')}`,
        );
    }
    return key;
}

// Comment text bound: TikTok rejects long comments at submit time.
// We validate length + non-empty up-front so the adapter never tries to
// paste an empty / overlong string into the contenteditable input.
export const COMMENT_TEXT_MAX = 150;

export function requireCommentText(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new ArgumentError(
            'comment text is required',
            'Example: opencli tiktok comment <url> "great video"',
        );
    }
    if (text.length > COMMENT_TEXT_MAX) {
        throw new ArgumentError(
            `comment text must be <= ${COMMENT_TEXT_MAX} characters (got ${text.length})`,
            'TikTok rejects long comments at submit time; trim before retrying',
        );
    }
    return text;
}

// Parses a TikTok video URL into {username, videoId, url}. Rejects bad
// shapes up-front so we never `goto()` an arbitrary page and silently
// pretend the click target was found. Both share-style links
// (vm.tiktok.com/...) and bare video IDs are out of scope — callers must
// pass the canonical /@user/video/id form.
export function parseTikTokVideoUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError(
            'video URL is required',
            'Example: opencli tiktok comment https://www.tiktok.com/@user/video/1234567890 "..."',
        );
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new ArgumentError(
            `invalid video URL: ${raw}`,
            'Example: https://www.tiktok.com/@user/video/1234567890',
        );
    }
    if (!/(^|\.)tiktok\.com$/i.test(parsed.hostname)) {
        throw new ArgumentError(
            `URL must be on tiktok.com (got ${parsed.hostname})`,
            'Example: https://www.tiktok.com/@user/video/1234567890',
        );
    }
    const match = parsed.pathname.match(/^\/@([A-Za-z0-9._-]+)\/video\/(\d+)\/?$/);
    if (!match) {
        throw new ArgumentError(
            'URL must follow /@<username>/video/<id> format',
            'Example: https://www.tiktok.com/@user/video/1234567890',
        );
    }
    return {
        url: parsed.toString(),
        username: match[1],
        videoId: match[2],
    };
}

export function looksTikTokAuthFailure(message) {
    return /\bAUTH_REQUIRED\b|\b(auth|captcha|login|log in|permission|unauthori[sz]ed|forbidden)\b|HTTP\s+(401|403)\b/i.test(String(message || ''));
}

export function looksTikTokUpstreamFailure(message) {
    return /\b(API failed|HTTP\s+\d+|invalid JSON|Failed to fetch|network|fetch)\b/i.test(String(message || ''));
}

export function throwTikTokPageContextError(error, { authMessage, emptyPattern, emptyTarget, failureMessage }) {
    const message = getErrorMessage(error);
    if (looksTikTokAuthFailure(message)) {
        throw new AuthRequiredError('tiktok.com', authMessage);
    }
    if (looksTikTokUpstreamFailure(message)) {
        throw new CommandExecutionError(`${failureMessage}: ${message}`);
    }
    if (emptyPattern.test(message)) {
        throw new EmptyResultError(emptyTarget, message);
    }
    throw new CommandExecutionError(`${failureMessage}: ${message}`);
}

// Sentinels emitted by Route 1 (button-walker) IIFEs and mapped here to
// typed errors. Keeping the strings constant in one place makes the IIFE
// `throw new Error(...)` callsites greppable and the mapper exhaustive.
export const BUTTON_WALKER_SENTINELS = {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    BUTTON_NOT_FOUND: 'BUTTON_NOT_FOUND',
    STATE_VERIFY_FAIL: 'STATE_VERIFY_FAIL',
    RATE_LIMITED: 'RATE_LIMITED',
};

// Retryability for write-class typed errors. Captured in the hint string
// so the human-readable output makes the retry contract explicit and
// downstream agents/scripts can grep for `retryable=true|false`.
//
// Comment is server-fan-out: a stale state-verify timeout does not prove
// the server rejected the comment, so retry can double-post.
// Follow / unfollow are client-safe: TikTok server-side dedupes the
// relation flip, so retry after a transient blip is harmless.
export const RETRYABLE_HINTS = {
    commentFailure: 'retryable=false reason=server-fan-out — TikTok may have accepted the comment but state verification timed out; do NOT auto-retry',
    relationFailure: 'retryable=true reason=idempotent — TikTok dedupes follow/unfollow on retry; safe to re-run',
};

// Maps a Route 1 (button-walker) IIFE error to a typed error. We do NOT
// map to EmptyResultError for write commands: a missing button or failed
// state verification is a contract violation, not an empty result set.
// Network / page-load failures reach this path only when the live page
// itself failed to render — they still surface as CommandExecutionError.
export function throwButtonWalkerError(error, { authMessage, failureMessage, retryableHint }) {
    const message = getErrorMessage(error);
    if (/\bRATE_LIMITED\b|\b(captcha|too many requests|rate limit|try again later|slow down)\b/i.test(message)) {
        throw new CommandExecutionError(
            `${failureMessage}: ${message}`,
            retryableHint,
        );
    }
    if (looksTikTokAuthFailure(message)) {
        throw new AuthRequiredError('tiktok.com', authMessage);
    }
    throw new CommandExecutionError(
        `${failureMessage}: ${message}`,
        retryableHint,
    );
}

// Browser-side helper bundle. Embedded into IIFEs as a string template.
// Stays self-contained so an adapter can paste `${BROWSER_HELPERS}` into its
// `page.evaluate` script and call any helper inside.
export const BROWSER_HELPERS = `
function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, maxLength ?? 500);
}

function getCookie(name) {
  const prefix = name + '=';
  for (const part of (document.cookie || '').split('; ')) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return '';
}

async function fetchJson(url) {
  const requestUrl = new URL(url, ${JSON.stringify(TIKTOK_HOST)}).toString();
  const res = await fetch(requestUrl, {
    credentials: 'include',
    headers: { accept: 'application/json,text/plain,*/*' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ' from ' + requestUrl + ': ' + text.slice(0, 160));
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('invalid JSON from ' + requestUrl + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

function assertTikTokApiSuccess(data, label) {
  if (!data || typeof data !== 'object') return;
  const code = data.status_code ?? data.statusCode;
  if (code === undefined || code === null || Number(code) === 0) return;
  const message = cleanText(data.status_msg ?? data.statusMsg ?? data.message ?? data.msg ?? code, 240);
  if (Number(code) === 8 || /auth|captcha|login|permission|unauthori[sz]ed|forbidden/i.test(message)) {
    throw new Error('AUTH_REQUIRED: ' + label + ' API failed: ' + message);
  }
  throw new Error(label + ' API failed: ' + message);
}

function findUniversalData() {
  const scripts = Array.from(document.querySelectorAll('script'));
  for (const script of scripts) {
    const text = script.textContent || '';
    if (!text || text.length < 32) continue;
    const trimmed = text.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) continue;
    if (
      !text.includes('webapp.user-detail') &&
      !text.includes('webapp.recommend-feed') &&
      !text.includes('webapp.live-discover') &&
      !text.includes('ItemModule') &&
      !text.includes('itemList') &&
      !text.includes('userInfo') &&
      !text.includes('userList') &&
      !text.includes('noticeList')
    ) {
      continue;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue scanning; TikTok keeps multiple JSON-like script tags.
    }
  }
  return null;
}

function walkObjects(root, visit) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (visit(current) === true) return true;
    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }
    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return false;
}

function findValueByKey(root, key) {
  let found = null;
  walkObjects(root, (node) => {
    if (Array.isArray(node)) return false;
    if (node && Object.prototype.hasOwnProperty.call(node, key) && node[key] != null) {
      found = node[key];
      return true;
    }
    return false;
  });
  return found;
}

function pickAuthor(author) {
  if (!author || typeof author !== 'object') return {};
  return {
    uniqueId: String(author.uniqueId || author.unique_id || author.user_id || '').replace(/^@+/, ''),
    nickname: cleanText(author.nickname || author.nickName || author.name, 80),
    secUid: String(author.secUid || author.sec_uid || ''),
    verified: Boolean(author.verified || author.is_verified || author.custom_verify),
  };
}
`;

// Sanitises a raw TikTok video item into the shape used across adapters.
// Stays in browser context — the IIFE pastes this builder into its body via
// the BROWSER_HELPERS bundle plus the adapter-specific normalisation.
export const VIDEO_ITEM_NORMALIZER = `
function normalizeVideoItem(item, indexHint) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || item.item_id || item.video_id || '').trim();
  if (!id) return null;
  const author = pickAuthor(item.author || item.authorInfo);
  const stats = item.stats || item.statistics || item.statsV2 || {};
  const video = item.video || item.videoInfo || {};
  const cover = video.cover || video.originCover || video.dynamicCover || video.coverUrl || item.cover || item.cover_url || '';
  const desc = cleanText(item.desc || item.title || item.description, 500);
  const createTime = asNumber(item.createTime ?? item.create_time ?? item.create_time_sec ?? item.post_time);
  const username = author.uniqueId;
  return {
    index: indexHint,
    id,
    author: username,
    url: username ? ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username) + '/video/' + encodeURIComponent(id) : '',
    cover: String(cover || ''),
    title: desc,
    desc,
    plays: asNumber(stats.playCount ?? stats.play_count ?? stats.viewCount ?? stats.view_count),
    likes: asNumber(stats.diggCount ?? stats.digg_count ?? stats.likeCount ?? stats.like_count),
    comments: asNumber(stats.commentCount ?? stats.comment_count),
    shares: asNumber(stats.shareCount ?? stats.share_count),
    createTime,
  };
}
`;

export const USER_ITEM_NORMALIZER = `
function normalizeUserRow(user, indexHint) {
  if (!user || typeof user !== 'object') return null;
  const username = String(user.uniqueId || user.unique_id || user.user_id || '').replace(/^@+/, '');
  if (!username) return null;
  const stats = user.stats || user.statistics || {};
  return {
    index: indexHint,
    username,
    name: cleanText(user.nickname || user.nickName || user.name, 80) || username,
    secUid: String(user.secUid || user.sec_uid || ''),
    verified: Boolean(user.verified || user.is_verified || user.custom_verify),
    followers: asNumber(stats.followerCount ?? stats.follower_count),
    following: asNumber(stats.followingCount ?? stats.following_count),
    url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username),
  };
}
`;

// Live-stream items differ from videos: they expose roomId / hosts / viewer counts.
export const LIVE_ITEM_NORMALIZER = `
function normalizeLiveItem(item, indexHint) {
  if (!item || typeof item !== 'object') return null;
  const room = item.room || item.liveRoom || item;
  const owner = room.owner || item.owner || room.user || {};
  const roomId = String(room.id || room.room_id || item.id || '').trim();
  const username = String(owner.uniqueId || owner.unique_id || owner.user_id || '').replace(/^@+/, '');
  if (!roomId && !username) return null;
  return {
    index: indexHint,
    streamer: username,
    name: cleanText(owner.nickname || owner.nickName || owner.name, 80) || username,
    title: cleanText(room.title || room.subtitle || item.title, 200),
    viewers: asNumber(room.user_count ?? room.viewerCount ?? room.viewer_count ?? item.viewer_count),
    likes: asNumber(room.like_count ?? room.likeCount ?? item.like_count),
    secUid: String(owner.secUid || owner.sec_uid || ''),
    url: username
      ? ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username) + '/live'
      : (roomId ? ${JSON.stringify(TIKTOK_HOST)} + '/live/' + encodeURIComponent(roomId) : ''),
  };
}
`;

export const NOTIFICATION_NORMALIZER = `
function normalizeNotification(item, indexHint) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.notice_id || item.id || item.notification_id || '').trim() || ('idx-' + indexHint);
  const fromUser = item.from_user || item.fromUser || item.user || {};
  const fromName = String(fromUser.uniqueId || fromUser.unique_id || fromUser.nickname || fromUser.nickName || '').replace(/^@+/, '');
  const text = cleanText(item.content || item.notice_content || item.text || item.body, 220);
  const createTime = asNumber(
    item.create_time
      ?? item.createTime
      ?? item.timestamp
      ?? (typeof item.time === 'number' ? item.time : null),
  );
  return {
    index: indexHint,
    id,
    from: fromName,
    text,
    createTime,
  };
}
`;

// Browser-side helpers for Route 1 (button-walker) write commands.
// Depends on `findUniversalData / walkObjects / getCookie` from
// BROWSER_HELPERS — adapters must paste BROWSER_HELPERS first, then
// BUTTON_WALKER_HELPERS, in the same `page.evaluate` script.
//
// Sentinels (AUTH_REQUIRED / BUTTON_NOT_FOUND / STATE_VERIFY_FAIL /
// RATE_LIMITED) are mirrored from BUTTON_WALKER_SENTINELS — Node-side
// `throwButtonWalkerError()` matches on these strings to map back to
// typed errors. Keep both sides in sync.
export const BUTTON_WALKER_HELPERS = `
function checkLoggedIn() {
  if (getCookie('sessionid') || getCookie('sid_tt') || getCookie('uid_tt')) return true;
  const root = findUniversalData();
  if (!root) return false;
  let found = false;
  walkObjects(root, (node) => {
    if (Array.isArray(node)) return false;
    const candidate = node && node.user;
    if (candidate && typeof candidate === 'object') {
      const secUid = String(candidate.secUid || candidate.sec_uid || '').trim();
      const isMe = Boolean(candidate.isOwner || candidate.is_owner || candidate.isCurrentUser);
      if (secUid && isMe) {
        found = true;
        return true;
      }
    }
    return false;
  });
  return found;
}

function findButtonByText(texts) {
  const targets = new Set(texts);
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim();
    if (targets.has(text)) return btn;
  }
  return null;
}

function buttonExists(texts) {
  return findButtonByText(texts) !== null;
}

function detectRateLimitPopup() {
  const text = (document.body && document.body.textContent || '').toLowerCase();
  if (/too many requests|rate limit|try again later|slow down/.test(text)) return true;
  if (document.querySelector('[data-e2e="captcha"], .captcha-mask, .secsdk-captcha-wrapper')) {
    return true;
  }
  return false;
}

async function waitFor(predicate, options) {
  const opts = options || {};
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 5000;
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (predicate()) return true; } catch { /* swallow predicate errors */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function ensureLoggedInOrThrow() {
  if (!checkLoggedIn()) {
    throw new Error('AUTH_REQUIRED: TikTok login required');
  }
}

function ensureNoRateLimitOrThrow() {
  if (detectRateLimitPopup()) {
    throw new Error('RATE_LIMITED: TikTok rate limit / captcha detected');
  }
}
`;
