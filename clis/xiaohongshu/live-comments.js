/**
 * Xiaohongshu live-comments — capture the comment stream of a live room.
 *
 * Architecture (the MutationObserverWatcher pattern from
 * DimensionDev/Holoflows-Kit, re-implemented clean-room — that library is
 * AGPL-3.0 and OpenCLI is Apache-2.0, so the pattern is adopted, not the
 * code): an in-page watcher observes document.body with a MutationObserver
 * and captures every `.virtual-list-item` chat node exactly once (WeakSet on
 * node identity — identical repeated texts stay distinct events). The DOM is
 * the data source ON PURPOSE: `__INITIAL_STATE__.liveStream.comments` looks
 * richer (userId/commentId) but holds only the SSR-initial batch plus local
 * echoes of the viewer's own sends — crowd comments stream over WebSocket
 * straight into the DOM and never touch that store (verified live in a
 * 1600-viewer room: the store stayed frozen while chat flowed). Items are
 * classified by shape: chat / enter ("XX 来了") / like / notice.
 *
 * The watcher lives on the persistent site tab ACROSS CLI invocations:
 * install once, then repeated `--duration 0` calls drain only what arrived
 * since the last call — a streaming loop out of one-shot commands, with
 * nothing lost between calls even when the page's own comment window slides.
 * This command therefore navigates with a PLAIN goto: the extension's
 * same-URL fast-path is what keeps the installed watcher alive. Running
 * other xiaohongshu commands in between navigates the shared tab away and
 * resets the watcher — keep a comment-capture loop on its own profile, or
 * accept a fresh install on the next call.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';

const MAX_DURATION_S = 60;
const BUFFER_CAP = 2000;
const WATCHER_VERSION = 3;

export function buildLiveWatcherInstallJs() {
    return `
    (() => {
      const existing = window.__opencli_live_watch;
      if (existing?.installed && existing.v === ${WATCHER_VERSION}) return { installed: true, fresh: false };
      try { existing?.observer?.disconnect?.(); } catch { /* replace anyway */ }
      const state = { installed: true, v: ${WATCHER_VERSION}, buf: [], seen: new WeakSet() };
      const extract = (item) => {
        if (item.querySelector('.risk-text')) {
          const text = (item.textContent || '').replace(/\s+/g, ' ').replace(/^通知\s*/, '').trim();
          return { kind: 'notice', nickname: '', msg: text };
        }
        const nickEl = item.querySelector('.nickname');
        const contentEl = item.querySelector('.msg-content') ?? item;
        const nickname = (nickEl?.textContent || '').trim();
        let msg = '';
        for (const node of contentEl.childNodes) {
          if (nickEl && (node === nickEl || (node.nodeType === 1 && node.contains(nickEl)))) continue;
          msg += node.textContent ?? '';
        }
        msg = msg.replace(/\s+/g, ' ').trim();
        const kind = msg === '来了' ? 'enter' : msg === '为主播点赞了' ? 'like' : 'chat';
        return { kind, nickname, msg };
      };
      const capture = (item) => {
        if (state.seen.has(item)) return;
        state.seen.add(item);
        const row = extract(item);
        if (!row.msg && !row.nickname) return;
        state.buf.push(row);
        if (state.buf.length > ${BUFFER_CAP}) state.buf.shift();
      };
      const sweep = () => {
        for (const item of document.querySelectorAll('.virtual-list-item')) capture(item);
      };
      sweep();
      // Observe document.body, not the chat container: the SPA tears down and
      // recreates the chat node on re-renders, which silently kills an
      // observer attached to it (seen live). body is never replaced.
      const observer = new MutationObserver(sweep);
      observer.observe(document.body, { childList: true, subtree: true });
      state.observer = observer;
      state.sweep = sweep;
      window.__opencli_live_watch = state;
      return { installed: true, fresh: true };
    })()
  `;
}

export function buildLiveWatcherDrainJs() {
    return `
    (() => {
      const state = window.__opencli_live_watch;
      if (!state?.installed) return { installed: false, items: [] };
      // Final sweep: items rendered without a caught mutation are never lost.
      try { state.sweep?.(); } catch { /* drain what we have */ }
      return { installed: true, items: state.buf.splice(0, state.buf.length) };
    })()
  `;
}

export function parseRoomUrl(raw) {
    const input = String(raw ?? '').trim();
    if (/^\d{6,}$/.test(input)) {
        return `https://www.xiaohongshu.com/livestream/${input}`;
    }
    let parsed;
    try {
        parsed = new URL(input);
    }
    catch {
        throw new ArgumentError('room-url must be a numeric room id or a full https://www.xiaohongshu.com/livestream/... URL');
    }
    if (parsed.hostname !== 'www.xiaohongshu.com' || !/^\/livestream\/\d+/.test(parsed.pathname)) {
        throw new ArgumentError('room-url must point at www.xiaohongshu.com/livestream/<room_id>', 'Use a room URL from `xiaohongshu lives` or the live list page.');
    }
    return parsed.toString();
}

function parseDuration(raw) {
    const parsed = Number(raw ?? 15);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > MAX_DURATION_S) {
        throw new ArgumentError(`--duration must be an integer between 0 and ${MAX_DURATION_S} seconds, got ${JSON.stringify(raw)}`, '0 drains whatever accumulated since the previous call.');
    }
    return parsed;
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'live-comments',
    access: 'read',
    description: '采集小红书直播间评论流（页内 MutationObserver 持续捕获，跨调用不丢）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'room-url', required: true, positional: true, help: 'Room URL from `xiaohongshu lives` (or a bare numeric room id)' },
        { name: 'duration', type: 'int', default: 15, help: `Seconds to collect before draining (0-${MAX_DURATION_S}; 0 = drain what accumulated since the last call)` },
        { name: 'limit', type: 'int', default: 200, help: 'Maximum comments to return' },
    ],
    columns: ['seq', 'kind', 'nickname', 'msg'],
    func: async (page, kwargs) => {
        const url = parseRoomUrl(kwargs['room-url']);
        const duration = parseDuration(kwargs.duration);
        const limit = Math.max(1, Number(kwargs.limit ?? 200));
        // Plain goto on purpose: a warm tab already in this room fast-paths
        // without reloading, which keeps the installed watcher (and its
        // dedupe state) alive across CLI invocations.
        await page.goto(url);
        await page.wait({ time: 2 });
        const install = unwrapEvaluateResult(await page.evaluate(buildLiveWatcherInstallJs()));
        if (!install || typeof install !== 'object' || install.installed !== true) {
            throw new CommandExecutionError('xiaohongshu live-comments: failed to install the in-page comment watcher');
        }
        if (duration > 0) {
            await page.wait({ time: duration });
        }
        const drained = unwrapEvaluateResult(await page.evaluate(buildLiveWatcherDrainJs()));
        if (!drained || typeof drained !== 'object' || !Array.isArray(drained.items)) {
            throw new CommandExecutionError('xiaohongshu live-comments: watcher drain returned a malformed payload');
        }
        const rows = drained.items
            .filter((item) => item && typeof item === 'object' && (item.msg || item.nickname))
            .slice(0, limit)
            .map((item, index) => ({
            seq: index + 1,
            kind: String(item.kind ?? 'chat'),
            nickname: String(item.nickname ?? ''),
            msg: String(item.msg ?? ''),
        }));
        if (rows.length === 0) {
            if (duration === 0 && install.fresh === true) {
                throw new EmptyResultError('xiaohongshu live-comments', 'The watcher was freshly installed on this call (the tab had navigated away or this is the first call for this room) — nothing was buffered yet. Call again to drain from here on.');
            }
            throw new EmptyResultError('xiaohongshu live-comments', duration > 0
                ? `No comments arrived within ${duration}s — the room may be quiet or the stream ended.`
                : 'The watcher stayed alive but nothing new arrived since the previous drain.');
        }
        return rows;
    },
});
