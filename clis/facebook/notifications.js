// Facebook notifications — pulls the rendered notification feed from
// `www.facebook.com/notifications` via in-page DOM walk.
//
// Replaces the legacy `pipeline:[]` form. The previous adapter had four
// overlapping silent failures the new shape resolves:
//   1. silent-bad-shape — `text.substring(0, 150)` truncated long
//      notification bodies without telling the caller.
//   2. silent-bad-shape — the old time field used a dash sentinel for
//      unknown values; typed unknown should be `null` so an agent caller
//      does not have to learn in-band sentinel strings.
//   3. silent-column-drop — the IIFE saw the `<div>未读</div>` /
//      `<div>Unread</div>` badge child and the anchor's `<a href>` URL
//      but kept neither, so callers got a bare text blob with no way
//      to follow up on a notification.
//   4. silent-empty-row — empty `[role="listitem"]` (login expired,
//      empty inbox, FB redirected to `/login`) returned `[]` instead
//      of throwing a typed error.
//
// New behavior:
//   - `func` form + `Strategy.COOKIE` + `browser:true`.
//   - Upfront `--limit` validation: positive integer in [1, 100], no
//     silent clamp; `ArgumentError` on bad input.
//   - Pure extractor `extractNotificationRowsFromDoc` is a Node-side
//     export — JSDOM-against-frozen-fixture tests call it directly while
//     the live IIFE embeds it via `${fn.toString()}` (mirrors hupu
//     #1387 / xiaoe #1388 / dianping #1313 pattern). Helpers
//     `stripMarkAsReadPrefix`, `stripAnchorChrome`, `parseNotifQuery`
//     are also pure exports for the same reason.
//   - Seven columns instead of three:
//       index, unread (bool), text (full, no truncation),
//       time (string|null), url (string), notif_id (string|null),
//       notif_type (string|null)
//   - Auth detection: if the IIFE runs while window.location is on a
//     login / checkpoint path, throw `AUTH_REQUIRED:` sentinel which
//     the Node side maps to `AuthRequiredError`.
//   - Empty list (after settle + auth check passes) → `EmptyResultError`,
//     never silent `[]`.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const FB_HOST = 'https://www.facebook.com';
export const NOTIFICATIONS_LIMIT_DEFAULT = 15;
export const NOTIFICATIONS_LIMIT_MAX = 100;

// Locale-specific "Mark as read" button prefixes Facebook attaches to
// the per-row mark-as-read action. We use this to recover the bare
// notification body text without the leading "未读" / "Unread" badge or
// the trailing time-ago suffix that the anchor's textContent contains.
//
// Each entry must be a complete, deterministic prefix — no regex — so a
// rare false-positive substring match elsewhere on the page does not
// silently truncate body text.
export const MARK_AS_READ_PREFIXES = [
    '标记为已读，',
    'Mark as read, ',
    'Mark as Read, ',
    'Marquer comme lu, ',
    'Marcar como leído, ',
    '既読にする, ',
];

// Localised "unread" badge labels that appear inside a `<div>` inside
// the notification listitem. Used to set the typed `unread` boolean.
export const UNREAD_BADGE_LABELS = ['未读', 'Unread', 'No leído', '未読'];

export function normalizeNotificationsLimit(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return NOTIFICATIONS_LIMIT_DEFAULT;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > NOTIFICATIONS_LIMIT_MAX) {
        throw new ArgumentError(
            `--limit must be a positive integer in [1, ${NOTIFICATIONS_LIMIT_MAX}], got ${JSON.stringify(raw)}`,
        );
    }
    return n;
}

// Pure: strip a Facebook locale-specific "mark as read" prefix from a
// `<div role="button">` aria-label so the caller gets the bare body
// text. Returns the stripped body, or `null` when the input does not
// start with a known prefix (i.e. we do not have a mark-as-read
// aria-label and the caller should fall through to anchor text).
//
// `prefixes` is injected so the same function works in JSDOM tests
// (passed the imported `MARK_AS_READ_PREFIXES`) and in the live IIFE
// (the array is inlined into the embedded script via `JSON.stringify`).
export function stripMarkAsReadPrefix(label, prefixes) {
    if (!label) return null;
    const text = String(label).trim();
    if (!text) return null;
    for (let i = 0; i < prefixes.length; i += 1) {
        const p = prefixes[i];
        if (text.startsWith(p)) return text.slice(p.length).trim();
    }
    return null;
}

// Pure: strip the leading "未读" / "Unread" badge prefix and the trailing
// time-ago suffix (e.g. "2天" / "5 hrs") from the rendered text of a
// notification anchor. Used as a fallback when the mark-as-read
// aria-label is not present (already-read rows).
//
// `badges` is the localized unread-badge labels list; `timeStr` is the
// trailing time string previously extracted from `<abbr>` (or `null`).
// Trailing `.` / `。` that Facebook inserts between body and time are
// also stripped — but only at the very end, never mid-text.
export function stripAnchorChrome(rawText, timeStr, badges) {
    if (!rawText) return '';
    let text = String(rawText).trim();
    for (let i = 0; i < badges.length; i += 1) {
        const b = badges[i];
        if (text.startsWith(b)) {
            text = text.slice(b.length).trim();
            break;
        }
    }
    if (timeStr) {
        const t = String(timeStr).trim();
        if (t && text.endsWith(t)) {
            text = text.slice(0, text.length - t.length).trim();
        }
    }
    text = text.replace(/[.。]+$/, '').trim();
    return text;
}

// Pure: extract `notif_id` and `notif_t` query params from a
// notification anchor href. Both fields stay `null` when absent so the
// caller can detect "this row has no canonical notif handle" (rare,
// but happens for some notification types FB inlines a non-canonical
// URL for) — never an in-band sentinel.
export function parseNotifQuery(rawHref, fbHost) {
    const out = { notif_id: null, notif_type: null };
    if (!rawHref) return out;
    let url;
    try {
        url = new URL(rawHref, fbHost);
    } catch (_) {
        return out;
    }
    out.notif_id = url.searchParams.get('notif_id') || null;
    out.notif_type = url.searchParams.get('notif_t') || null;
    return out;
}

export function isFacebookAuthRedirectPath(pathname) {
    return /^\/(?:login|checkpoint)(?:\.php)?(?:\/|$)/i.test(String(pathname || ''));
}

// Pure extractor: walks `[role="listitem"]` containers in `doc` and
// returns at most `limit` notification rows. Header listitems (those
// without an `<a href>` child — e.g. the "新通知" / "Earlier" section
// heading FB inserts at the top of the feed) are skipped.
//
// `helpers` carries the four pure helpers as positional refs so the
// same function works in JSDOM (test imports them) and in the live
// IIFE (embeds them via `${fn.toString()}`):
//   { stripMark, stripChrome, parseQuery, fbHost,
//     markPrefixes, unreadBadges }
export function extractNotificationRowsFromDoc(doc, limit, helpers) {
    const out = [];
    const items = doc.querySelectorAll('[role="listitem"]');
    for (let i = 0; i < items.length && out.length < limit; i += 1) {
        const item = items[i];
        const anchor = item.querySelector('a[href]');
        if (!anchor) continue;
        const href = anchor.href || anchor.getAttribute('href') || '';
        if (!href) continue;

        const abbr = item.querySelector('abbr');
        const time = abbr ? ((abbr.textContent || '').trim() || null) : null;

        // Unread badge: prefer the explicit `<div>未读</div>` /
        // `<div>Unread</div>` child; fall back to anchor text prefix.
        let unread = false;
        const allDivs = item.querySelectorAll('div');
        for (let j = 0; j < allDivs.length; j += 1) {
            const t = (allDivs[j].textContent || '').trim();
            if (helpers.unreadBadges.indexOf(t) !== -1) {
                unread = true;
                break;
            }
        }
        if (!unread) {
            const anchorText = (anchor.textContent || '').trim();
            for (let k = 0; k < helpers.unreadBadges.length; k += 1) {
                if (anchorText.startsWith(helpers.unreadBadges[k])) {
                    unread = true;
                    break;
                }
            }
        }

        // Body text — try every aria-label on descendants, take the
        // first one that the mark-as-read prefix helper recognises.
        // Fall back to the anchor's own textContent with badge / time
        // / trailing punctuation chrome stripped.
        let text = null;
        const labelHosts = item.querySelectorAll('[aria-label]');
        for (let k = 0; k < labelHosts.length; k += 1) {
            const label = labelHosts[k].getAttribute('aria-label');
            const stripped = helpers.stripMark(label, helpers.markPrefixes);
            if (stripped !== null) {
                const cleaned = stripped.replace(/[.。]+$/, '').trim();
                text = cleaned || null;
                break;
            }
        }
        if (!text) {
            const fallback = helpers.stripChrome(
                anchor.textContent || '',
                time,
                helpers.unreadBadges,
            );
            text = fallback || null;
        }
        if (!text) continue;

        const { notif_id, notif_type } = helpers.parseQuery(href, helpers.fbHost);
        out.push({
            index: out.length + 1,
            unread,
            text,
            time,
            url: href,
            notif_id,
            notif_type,
        });
    }
    return out;
}

export function buildNotificationsScript(limit) {
    return `
(async () => {
  const FB_HOST = ${JSON.stringify(FB_HOST)};
  const MARK_AS_READ_PREFIXES = ${JSON.stringify(MARK_AS_READ_PREFIXES)};
  const UNREAD_BADGE_LABELS = ${JSON.stringify(UNREAD_BADGE_LABELS)};
  ${isFacebookAuthRedirectPath.toString()}
  if (isFacebookAuthRedirectPath(window.location.pathname || '')) {
    throw new Error('AUTH_REQUIRED: facebook.com redirected to login');
  }
  ${stripMarkAsReadPrefix.toString()}
  ${stripAnchorChrome.toString()}
  ${parseNotifQuery.toString()}
  ${extractNotificationRowsFromDoc.toString()}
  // Wait briefly for [role="listitem"] rows to render in case the SPA
  // is still hydrating. 8s ceiling keeps a slow network from hanging
  // the command — empty list after that surfaces as EmptyResultError
  // on the Node side.
  const start = Date.now();
  while (document.querySelectorAll('[role="listitem"]').length === 0 && Date.now() - start < 8000) {
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  return extractNotificationRowsFromDoc(document, ${JSON.stringify(limit)}, {
    stripMark: stripMarkAsReadPrefix,
    stripChrome: stripAnchorChrome,
    parseQuery: parseNotifQuery,
    fbHost: FB_HOST,
    markPrefixes: MARK_AS_READ_PREFIXES,
    unreadBadges: UNREAD_BADGE_LABELS,
  });
})()
`;
}

async function getFacebookNotifications(page, args) {
    const limit = normalizeNotificationsLimit(args.limit);
    try {
        await page.goto(`${FB_HOST}/notifications`, { waitUntil: 'load', settleMs: 3000 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(
            `Failed to navigate to facebook notifications: ${message}`,
            'facebook.com may be unreachable',
        );
    }
    let rows;
    try {
        rows = await page.evaluate(buildNotificationsScript(limit));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/AUTH_REQUIRED/i.test(message)) {
            throw new AuthRequiredError(
                'facebook.com',
                'Open Chrome and log in to Facebook before retrying',
            );
        }
        throw new CommandExecutionError(
            `Failed to read facebook notifications: ${message}`,
            'facebook.com page may not have rendered or markup may have changed',
        );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(
            'facebook/notifications',
            'No notifications found — login session may have expired or you have no recent notifications',
        );
    }
    return rows;
}

export const notificationsCommand = cli({
    site: 'facebook',
    name: 'notifications',
    access: 'read',
    description: 'Get recent Facebook notifications (含 unread / time / url / notif_id / notif_type 列)',
    domain: 'www.facebook.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        {
            name: 'limit',
            type: 'int',
            default: NOTIFICATIONS_LIMIT_DEFAULT,
            help: `Number of notifications (1-${NOTIFICATIONS_LIMIT_MAX})`,
        },
    ],
    columns: ['index', 'unread', 'text', 'time', 'url', 'notif_id', 'notif_type'],
    func: getFacebookNotifications,
});

export const __test__ = {
    buildNotificationsScript,
};
