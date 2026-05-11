// Facebook notifications — unit tests for pure helpers + JSDOM fixture
// test for the `extractNotificationRowsFromDoc` extractor.
//
// The fixture (`__fixtures__/notifications-page.html`) is a frozen
// snapshot of `www.facebook.com/notifications` captured live from a
// logged-in session. Class names are stripped; SVG / `<i>` icon nodes
// are removed. The structure preserves what the extractor needs:
//   - 5 `[role="listitem"]` rows: 1 header ("新通知" — no anchor) +
//     4 real notifications across 3 distinct `notif_t` types
//     (`onthisday`, `approve_from_another_device`,
//     `group_recommendation`).
//   - Each data row has `<a href>` with `notif_id` + `notif_t` query
//     params, `<div>未读</div>` unread badge, `<abbr aria-label="N天前">
//     <span>N天</span></abbr>` for time, and a `<div role="button"
//     aria-label="标记为已读，<body>">` for the bare body text.
//
// Per dianping #1313 / hupu #1387 / xiaoe #1388 pattern: the live IIFE
// embeds the same `extractNotificationRowsFromDoc` function via
// `${fn.toString()}` so the extractor seen by these JSDOM tests is the
// exact same code that runs in the browser.

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

import {
    FB_HOST,
    NOTIFICATIONS_LIMIT_DEFAULT,
    NOTIFICATIONS_LIMIT_MAX,
    MARK_AS_READ_PREFIXES,
    UNREAD_BADGE_LABELS,
    normalizeNotificationsLimit,
    stripMarkAsReadPrefix,
    stripAnchorChrome,
    parseNotifQuery,
    isFacebookAuthRedirectPath,
    extractNotificationRowsFromDoc,
    buildNotificationsScript,
    notificationsCommand,
} from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(__dirname, '__fixtures__/notifications-page.html');
const fixtureHtml = readFileSync(fixturePath, 'utf8');
const manifestPath = resolve(__dirname, '../../cli-manifest.json');

function loadFixtureDoc() {
    return new JSDOM(fixtureHtml, { url: 'https://www.facebook.com/notifications' }).window.document;
}

function loadManifestCommand() {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return manifest.find(cmd => cmd.site === 'facebook' && cmd.name === 'notifications');
}

const fixtureHelpers = {
    stripMark: stripMarkAsReadPrefix,
    stripChrome: stripAnchorChrome,
    parseQuery: parseNotifQuery,
    fbHost: FB_HOST,
    markPrefixes: MARK_AS_READ_PREFIXES,
    unreadBadges: UNREAD_BADGE_LABELS,
};

describe('facebook/notifications — registration contract', () => {
    it('declares site/name/access/strategy/browser correctly', () => {
        expect(notificationsCommand.site).toBe('facebook');
        expect(notificationsCommand.name).toBe('notifications');
        expect(notificationsCommand.access).toBe('read');
        expect(notificationsCommand.strategy).toBe('cookie');
        expect(notificationsCommand.browser).toBe(true);
        expect(notificationsCommand.navigateBefore).toBe(false);
    });

    it('exposes the seven enrichment columns in stable order', () => {
        expect(notificationsCommand.columns).toEqual([
            'index',
            'unread',
            'text',
            'time',
            'url',
            'notif_id',
            'notif_type',
        ]);
    });

    it('declares limit arg with default and help string', () => {
        const limit = notificationsCommand.args.find(a => a.name === 'limit');
        expect(limit).toBeDefined();
        expect(limit.type).toBe('int');
        expect(limit.default).toBe(NOTIFICATIONS_LIMIT_DEFAULT);
        expect(limit.help).toContain(String(NOTIFICATIONS_LIMIT_MAX));
    });

    it('build manifest preserves navigateBefore=false so invalid limits do not pre-nav', () => {
        const manifestCommand = loadManifestCommand();
        expect(manifestCommand).toBeDefined();
        expect(manifestCommand.navigateBefore).toBe(false);
    });
});

describe('normalizeNotificationsLimit', () => {
    it('returns default for undefined / null / empty', () => {
        expect(normalizeNotificationsLimit(undefined)).toBe(NOTIFICATIONS_LIMIT_DEFAULT);
        expect(normalizeNotificationsLimit(null)).toBe(NOTIFICATIONS_LIMIT_DEFAULT);
        expect(normalizeNotificationsLimit('')).toBe(NOTIFICATIONS_LIMIT_DEFAULT);
    });

    it('accepts positive integer in range', () => {
        expect(normalizeNotificationsLimit(1)).toBe(1);
        expect(normalizeNotificationsLimit(50)).toBe(50);
        expect(normalizeNotificationsLimit(NOTIFICATIONS_LIMIT_MAX)).toBe(NOTIFICATIONS_LIMIT_MAX);
        expect(normalizeNotificationsLimit('25')).toBe(25);
    });

    it('rejects 0 / negative / over-max / non-integer / non-numeric — never silent clamps', () => {
        expect(() => normalizeNotificationsLimit(0)).toThrow(/positive integer/);
        expect(() => normalizeNotificationsLimit(-1)).toThrow(/positive integer/);
        expect(() => normalizeNotificationsLimit(NOTIFICATIONS_LIMIT_MAX + 1)).toThrow(
            new RegExp(`\\[1, ${NOTIFICATIONS_LIMIT_MAX}\\]`),
        );
        expect(() => normalizeNotificationsLimit(1.5)).toThrow(/positive integer/);
        expect(() => normalizeNotificationsLimit('abc')).toThrow(/positive integer/);
    });
});

describe('stripMarkAsReadPrefix', () => {
    it('strips known locale prefixes', () => {
        expect(stripMarkAsReadPrefix('标记为已读，回顾你在 2019年6月的那段过往.', MARK_AS_READ_PREFIXES))
            .toBe('回顾你在 2019年6月的那段过往.');
        expect(stripMarkAsReadPrefix('Mark as read, John liked your photo', MARK_AS_READ_PREFIXES))
            .toBe('John liked your photo');
        expect(stripMarkAsReadPrefix('Mark as Read, John liked your photo', MARK_AS_READ_PREFIXES))
            .toBe('John liked your photo');
    });

    it('returns null when prefix is missing — never silent default', () => {
        expect(stripMarkAsReadPrefix('管理Jake Win通知设置', MARK_AS_READ_PREFIXES)).toBeNull();
        expect(stripMarkAsReadPrefix('arbitrary aria-label without prefix', MARK_AS_READ_PREFIXES))
            .toBeNull();
    });

    it('returns null on missing / empty input', () => {
        expect(stripMarkAsReadPrefix(null, MARK_AS_READ_PREFIXES)).toBeNull();
        expect(stripMarkAsReadPrefix(undefined, MARK_AS_READ_PREFIXES)).toBeNull();
        expect(stripMarkAsReadPrefix('', MARK_AS_READ_PREFIXES)).toBeNull();
        expect(stripMarkAsReadPrefix('   ', MARK_AS_READ_PREFIXES)).toBeNull();
    });
});

describe('stripAnchorChrome', () => {
    it('strips leading 未读 / Unread badge', () => {
        expect(stripAnchorChrome('未读John liked your photo', null, UNREAD_BADGE_LABELS))
            .toBe('John liked your photo');
        expect(stripAnchorChrome('UnreadJohn liked your photo', null, UNREAD_BADGE_LABELS))
            .toBe('John liked your photo');
    });

    it('strips trailing time-ago suffix when timeStr is provided', () => {
        expect(stripAnchorChrome('未读回顾你在 2019年6月的那段过往.2天', '2天', UNREAD_BADGE_LABELS))
            .toBe('回顾你在 2019年6月的那段过往');
        expect(stripAnchorChrome('未读有人尝试登录，但我们已阻止。7周', '7周', UNREAD_BADGE_LABELS))
            .toBe('有人尝试登录，但我们已阻止');
    });

    it('keeps text intact when there is no badge / no time', () => {
        expect(stripAnchorChrome('John liked your photo', null, UNREAD_BADGE_LABELS))
            .toBe('John liked your photo');
    });

    it('returns empty string for falsy input', () => {
        expect(stripAnchorChrome('', null, UNREAD_BADGE_LABELS)).toBe('');
        expect(stripAnchorChrome(null, null, UNREAD_BADGE_LABELS)).toBe('');
    });
});

describe('parseNotifQuery', () => {
    it('extracts notif_id and notif_t from absolute URLs', () => {
        const href = 'https://www.facebook.com/photo/?fbid=104&set=a.105&notif_id=1777&notif_t=onthisday&ref=notif';
        expect(parseNotifQuery(href, FB_HOST)).toEqual({
            notif_id: '1777',
            notif_type: 'onthisday',
        });
    });

    it('handles relative URLs by resolving against fbHost', () => {
        expect(parseNotifQuery('/groups/discover/?notif_id=1234&notif_t=group_recommendation', FB_HOST))
            .toEqual({ notif_id: '1234', notif_type: 'group_recommendation' });
    });

    it('returns null fields when query params are absent — typed unknown', () => {
        expect(parseNotifQuery('https://www.facebook.com/photo/?fbid=999', FB_HOST))
            .toEqual({ notif_id: null, notif_type: null });
    });

    it('returns null fields for empty / unparseable input', () => {
        expect(parseNotifQuery('', FB_HOST)).toEqual({ notif_id: null, notif_type: null });
        expect(parseNotifQuery(null, FB_HOST)).toEqual({ notif_id: null, notif_type: null });
        // jsdom's URL constructor accepts a lot — pass an obviously broken
        // protocol to force the catch path.
        expect(parseNotifQuery('http://[::not-an-ipv6', FB_HOST))
            .toEqual({ notif_id: null, notif_type: null });
    });
});

describe('isFacebookAuthRedirectPath', () => {
    it('matches Facebook login/checkpoint paths including .php redirects', () => {
        expect(isFacebookAuthRedirectPath('/login')).toBe(true);
        expect(isFacebookAuthRedirectPath('/login/')).toBe(true);
        expect(isFacebookAuthRedirectPath('/login.php')).toBe(true);
        expect(isFacebookAuthRedirectPath('/login/identify/')).toBe(true);
        expect(isFacebookAuthRedirectPath('/checkpoint')).toBe(true);
        expect(isFacebookAuthRedirectPath('/checkpoint.php')).toBe(true);
    });

    it('does not match unrelated login-looking paths', () => {
        expect(isFacebookAuthRedirectPath('/loginhelp')).toBe(false);
        expect(isFacebookAuthRedirectPath('/help/login')).toBe(false);
        expect(isFacebookAuthRedirectPath('/notifications')).toBe(false);
    });
});

describe('extractNotificationRowsFromDoc — JSDOM against frozen fixture', () => {
    it('extracts 4 data rows (1 header skipped) with full schema and stable order', () => {
        const doc = loadFixtureDoc();
        const rows = extractNotificationRowsFromDoc(doc, 100, fixtureHelpers);
        expect(rows).toHaveLength(4);
        expect(rows[0]).toEqual({
            index: 1,
            unread: true,
            text: '回顾你在 2019年6月的那段过往',
            time: '2天',
            url: 'https://www.facebook.com/photo/?fbid=104250644186433&set=a.104250310853133&notif_id=1777926497886652&notif_t=onthisday&ref=notif',
            notif_id: '1777926497886652',
            notif_type: 'onthisday',
        });
        expect(rows[2]).toMatchObject({
            index: 3,
            unread: true,
            text: '有人尝试登录，但我们已阻止',
            time: '7周',
            notif_type: 'approve_from_another_device',
            notif_id: '1773680546395691',
        });
        expect(rows[3]).toMatchObject({
            index: 4,
            unread: true,
            text: '你可能会喜欢 ETYCAL VIBEZ fan\'s page',
            time: '2天',
            notif_type: 'group_recommendation',
        });
    });

    it('respects limit by returning at most N rows', () => {
        const doc = loadFixtureDoc();
        const rows = extractNotificationRowsFromDoc(doc, 2, fixtureHelpers);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.index)).toEqual([1, 2]);
    });

    it('skips the header listitem (no <a href>) — guards against silent empty', () => {
        const doc = loadFixtureDoc();
        const allListitems = doc.querySelectorAll('[role="listitem"]');
        expect(allListitems.length).toBe(5); // 1 header + 4 data
        const rows = extractNotificationRowsFromDoc(doc, 100, fixtureHelpers);
        expect(rows.length).toBe(4); // header skipped
        // None of the returned rows match the header text.
        for (const row of rows) {
            expect(row.text).not.toBe('新通知');
        }
    });

    it('text column has no truncation — bug fix vs legacy substring(0, 150)', () => {
        const doc = loadFixtureDoc();
        const rows = extractNotificationRowsFromDoc(doc, 100, fixtureHelpers);
        // The on-this-day row body is 16+ chars; the legacy adapter would
        // have happily returned anything <= 150. The point of this test
        // is to assert nothing is silently sliced — full body text round-
        // trips through the extractor.
        expect(rows[0].text).toBe('回顾你在 2019年6月的那段过往');
        expect(rows[1].text).toBe('看看你在 2019年6月发布的帖子，瞬间回到过去的美好时光');
        // No row has a value that ends with our legacy truncation point.
        for (const row of rows) {
            expect(row.text).not.toMatch(/\u2026$/); // U+2026 ellipsis as a defensive check
        }
    });

    it('time is null (typed unknown) when abbr is missing — never the legacy "-" sentinel', () => {
        // Build a one-off JSDOM doc that mimics a row without an abbr.
        const html = `<!doctype html><html><body><div role="main">
            <div role="listitem">
              <a href="https://www.facebook.com/page?notif_id=999&notif_t=test_event">
                <span><div>未读</div>Body text without time</span>
              </a>
            </div>
        </body></html>`;
        const doc = new JSDOM(html).window.document;
        const rows = extractNotificationRowsFromDoc(doc, 5, fixtureHelpers);
        expect(rows).toHaveLength(1);
        expect(rows[0].time).toBeNull();
        expect(rows[0].text).toBe('Body text without time');
    });

    it('unread is false when no badge is present — bug fix vs legacy column-drop', () => {
        const html = `<!doctype html><html><body><div role="main">
            <div role="listitem">
              <a href="https://www.facebook.com/x?notif_id=1&notif_t=read">
                <span>Already read notification</span>
                <abbr aria-label="3 hr"><span>3 hr</span></abbr>
              </a>
            </div>
        </body></html>`;
        const doc = new JSDOM(html).window.document;
        const rows = extractNotificationRowsFromDoc(doc, 5, fixtureHelpers);
        expect(rows).toHaveLength(1);
        expect(rows[0].unread).toBe(false);
        expect(rows[0].text).toBe('Already read notification');
    });

    it('resolves relative hrefs to full URLs for the url column', () => {
        const html = `<!doctype html><html><body><div role="main">
            <div role="listitem">
              <a href="/groups/discover/?notif_id=42&notif_t=group_recommendation">
                <span>UnreadRelative URL body</span>
                <abbr aria-label="1 hr"><span>1 hr</span></abbr>
              </a>
            </div>
        </body></html>`;
        const doc = new JSDOM(html, { url: 'https://www.facebook.com/notifications' }).window.document;
        const rows = extractNotificationRowsFromDoc(doc, 5, fixtureHelpers);
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toBe('https://www.facebook.com/groups/discover/?notif_id=42&notif_t=group_recommendation');
        expect(rows[0].notif_id).toBe('42');
        expect(rows[0].notif_type).toBe('group_recommendation');
    });

    it('skips anchor rows with no recoverable body text — no text:null success rows', () => {
        const html = `<!doctype html><html><body><div role="main">
            <div role="listitem">
              <a href="https://www.facebook.com/x?notif_id=1&notif_t=blank">
                <span><div>未读</div></span>
                <abbr aria-label="3 hr"><span>3 hr</span></abbr>
              </a>
            </div>
        </body></html>`;
        const doc = new JSDOM(html).window.document;
        const rows = extractNotificationRowsFromDoc(doc, 5, fixtureHelpers);
        expect(rows).toEqual([]);
    });

    it('returns [] for a doc with no listitems — Node side maps to EmptyResultError', () => {
        const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
        const rows = extractNotificationRowsFromDoc(doc, 5, fixtureHelpers);
        expect(rows).toEqual([]);
    });
});

describe('buildNotificationsScript — IIFE invariants', () => {
    it('embeds all four pure helpers via fn.toString()', () => {
        const script = buildNotificationsScript(15);
        expect(script).toContain('function stripMarkAsReadPrefix');
        expect(script).toContain('function stripAnchorChrome');
        expect(script).toContain('function parseNotifQuery');
        expect(script).toContain('function isFacebookAuthRedirectPath');
        expect(script).toContain('function extractNotificationRowsFromDoc');
    });

    it('inlines limit and FB_HOST so the live page does not depend on Node closures', () => {
        const script = buildNotificationsScript(7);
        expect(script).toMatch(/extractNotificationRowsFromDoc\(document,\s*7,/);
        expect(script).toContain('"https://www.facebook.com"');
    });

    it('inlines locale prefix and badge tables so the IIFE has them at runtime', () => {
        const script = buildNotificationsScript(15);
        expect(script).toContain('"标记为已读，"');
        expect(script).toContain('"未读"');
        expect(script).toContain('"Unread"');
    });

    it('contains an auth-redirect guard before the DOM walk', () => {
        const script = buildNotificationsScript(15);
        expect(script).toMatch(/AUTH_REQUIRED.*facebook/i);
        expect(script).toContain('isFacebookAuthRedirectPath(window.location.pathname');
    });

    it('does NOT contain the legacy silent-truncation slice/substring — anti-pattern regression guard', () => {
        const script = buildNotificationsScript(15);
        // Legacy: text.substring(0, 150) — silent-bad-shape that this PR fixes.
        expect(script).not.toMatch(/text\.substring\(0,\s*150\)/);
        // Legacy: time || '-' — silent sentinel that this PR fixes.
        expect(script).not.toMatch(/time\s*\|\|\s*['"]-['"]/);
    });
});

describe('facebook/notifications — func typed boundaries', () => {
    function createPageMock(rows) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(rows),
        };
    }

    function createFailingPageMock(error, { failGoto = false } = {}) {
        return {
            goto: vi.fn(failGoto ? () => Promise.reject(error) : () => Promise.resolve()),
            evaluate: vi.fn(failGoto ? () => Promise.resolve([]) : () => Promise.reject(error)),
        };
    }

    it('validates --limit upfront before navigation', async () => {
        const page = createPageMock([]);
        await expect(notificationsCommand.func(page, { limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(notificationsCommand.func(page, { limit: NOTIFICATIONS_LIMIT_MAX + 1 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('returns rows verbatim on success', async () => {
        const row = {
            index: 1,
            unread: true,
            text: 'hello',
            time: '2天',
            url: 'https://www.facebook.com/notifications/?notif_id=1&notif_t=test',
            notif_id: '1',
            notif_type: 'test',
        };
        await expect(notificationsCommand.func(createPageMock([row]), { limit: 1 })).resolves.toEqual([row]);
    });

    it('maps empty rows to EmptyResultError', async () => {
        await expect(notificationsCommand.func(createPageMock([]), { limit: 1 })).rejects.toThrow(EmptyResultError);
    });

    it('maps auth sentinel evaluate failures to AuthRequiredError', async () => {
        const page = createFailingPageMock(new Error('AUTH_REQUIRED: facebook.com redirected to login'));
        await expect(notificationsCommand.func(page, { limit: 1 })).rejects.toThrow(AuthRequiredError);
    });

    it('wraps navigation and evaluate failures as CommandExecutionError', async () => {
        await expect(
            notificationsCommand.func(createFailingPageMock(new Error('network down'), { failGoto: true }), { limit: 1 }),
        ).rejects.toThrow(CommandExecutionError);
        await expect(
            notificationsCommand.func(createFailingPageMock(new Error('selector crashed')), { limit: 1 }),
        ).rejects.toThrow(CommandExecutionError);
    });
});
