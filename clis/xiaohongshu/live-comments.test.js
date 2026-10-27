import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { buildLiveWatcherDrainJs, buildLiveWatcherInstallJs } from './live-comments.js';
import './live-comments.js';

const ROOM_URL = 'https://www.xiaohongshu.com/livestream/570440812909234340?xsec_token=ABtok';

function comment(id, msg, nick = '晶晶') {
    return {
        commentId: id,
        msg,
        nickName: nick,
        userId: `u-${id}`,
        commentType: 0,
        avatar: 'https://a/b.jpg',
        fansGroup: { groupName: '毛毛拖鞋', groupLevel: 2 },
    };
}

function makeRoomDom(initialComments) {
    const dom = new JSDOM('<div class="live-chat"><div class="virtual-list"></div></div>', {
        url: 'https://www.xiaohongshu.com/livestream/1',
    });
    const win = dom.window;
    win.__INITIAL_STATE__ = { liveStream: { comments: { _value: initialComments } } };
    const run = (script) => Function('window', 'document', 'MutationObserver', `return (${script})`)(
        win, win.document, win.MutationObserver,
    );
    const touchChat = async () => {
        win.document.querySelector('.virtual-list').appendChild(win.document.createElement('div'));
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { win, run, touchChat };
}

describe('live-comments in-page watcher v3 (DOM-sourced, real MutationObserver in JSDOM)', () => {
    function chatItem(doc, nickname, msg, { notice = false } = {}) {
        const item = doc.createElement('div');
        item.className = 'virtual-list-item';
        if (notice) {
            item.innerHTML = '<div class="risk-text"><div class="risk-item"><span class="risk-tip">通知</span>' + msg + '</div></div>';
            return item;
        }
        const wrapper = doc.createElement('div');
        wrapper.className = 'msg-wrapper';
        const content = doc.createElement('div');
        content.className = 'msg-content';
        const nick = doc.createElement('span');
        nick.className = 'nickname';
        nick.textContent = nickname;
        content.appendChild(nick);
        content.appendChild(doc.createTextNode(' ' + msg));
        wrapper.appendChild(content);
        item.appendChild(wrapper);
        return item;
    }

    function makeRoom(initial = []) {
        const dom = new JSDOM('<div class="live-chat"><div class="virtual-list"></div></div>', {
            url: 'https://www.xiaohongshu.com/livestream/1',
        });
        const win = dom.window;
        const list = win.document.querySelector('.virtual-list');
        for (const [nick, msg, opts] of initial) list.appendChild(chatItem(win.document, nick, msg, opts));
        const run = (script) => Function('window', 'document', 'MutationObserver', `return (${script})`)(
            win, win.document, win.MutationObserver,
        );
        const addComment = async (nick, msg, opts) => {
            list.appendChild(chatItem(win.document, nick, msg, opts));
            await new Promise((resolve) => setTimeout(resolve, 0));
        };
        return { win, run, addComment };
    }

    it('captures the initial chat items on install and drains them once', () => {
        const { run } = makeRoom([['晶晶', '这个咖啡机怎么卖']]);
        expect(run(buildLiveWatcherInstallJs())).toEqual({ installed: true, fresh: true });
        const first = run(buildLiveWatcherDrainJs());
        expect(first.items).toEqual([{ kind: 'chat', nickname: '晶晶', msg: '这个咖啡机怎么卖' }]);
        expect(run(buildLiveWatcherDrainJs()).items).toEqual([]);
    });

    it('captures comments appended after install — including identical repeated texts', async () => {
        const { run, addComment } = makeRoom();
        run(buildLiveWatcherInstallJs());
        await addComment('甲', '666');
        await addComment('乙', '666');
        await addComment('甲', '666');
        const drained = run(buildLiveWatcherDrainJs());
        expect(drained.items.map((i) => i.nickname + ':' + i.msg)).toEqual(['甲:666', '乙:666', '甲:666']);
    });

    it('classifies enter/like/notice events', async () => {
        const { run, addComment } = makeRoom();
        run(buildLiveWatcherInstallJs());
        await addComment('路人', '来了');
        await addComment('小可爱', '为主播点赞了');
        await addComment('', '平台倡导文明健康的直播环境', { notice: true });
        await addComment('丙', '主播加油');
        const drained = run(buildLiveWatcherDrainJs());
        expect(drained.items.map((i) => i.kind)).toEqual(['enter', 'like', 'notice', 'chat']);
        expect(drained.items[3]).toEqual({ kind: 'chat', nickname: '丙', msg: '主播加油' });
    });

    it('keeps capturing after the chat container node is replaced by the SPA', async () => {
        const { win, run } = makeRoom([['甲', 'a']]);
        run(buildLiveWatcherInstallJs());
        run(buildLiveWatcherDrainJs());
        const doc = win.document;
        doc.querySelector('.live-chat').remove();
        const fresh = doc.createElement('div');
        fresh.className = 'live-chat';
        fresh.innerHTML = '<div class="virtual-list"></div>';
        doc.body.appendChild(fresh);
        fresh.querySelector('.virtual-list').appendChild(chatItem(doc, '乙', 'b'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const drained = run(buildLiveWatcherDrainJs());
        expect(drained.items).toEqual([{ kind: 'chat', nickname: '乙', msg: 'b' }]);
    });

    it('drain performs a final sweep so items rendered without a caught mutation are never missed', () => {
        const { win, run } = makeRoom([['甲', 'a']]);
        run(buildLiveWatcherInstallJs());
        run(buildLiveWatcherDrainJs());
        // Appended synchronously with no microtask yield: observer callback never ran.
        win.document.querySelector('.virtual-list').appendChild(chatItem(win.document, '乙', 'b'));
        const drained = run(buildLiveWatcherDrainJs());
        expect(drained.items).toEqual([{ kind: 'chat', nickname: '乙', msg: 'b' }]);
    });

    it('is idempotent for the current version and replaces outdated watchers', () => {
        const { win, run } = makeRoom([['甲', 'a']]);
        run(buildLiveWatcherInstallJs());
        expect(run(buildLiveWatcherInstallJs())).toEqual({ installed: true, fresh: false });
        win.__opencli_live_watch = { installed: true, v: 1, buf: [], observer: { disconnect: () => {} } };
        expect(run(buildLiveWatcherInstallJs())).toEqual({ installed: true, fresh: true });
        const drained = run(buildLiveWatcherDrainJs());
        expect(drained.items).toEqual([{ kind: 'chat', nickname: '甲', msg: 'a' }]);
    });

    it('drain on a page without the watcher reports installed=false', () => {
        const { run } = makeRoom();
        expect(run(buildLiveWatcherDrainJs())).toEqual({ installed: false, items: [] });
    });
});

describe('xiaohongshu/live-comments command', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/live-comments');

    function makePage({ drains = [{ installed: true, items: [{ kind: 'chat', nickname: 'Joce1yn', msg: '好优雅' }] }], fresh = true } = {}) {
        let drainIndex = 0;
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                const s = String(script);
                if (s.includes('splice')) return drains[Math.min(drainIndex++, drains.length - 1)];
                if (s.includes('__opencli_live_watch')) return { installed: true, fresh };
                throw new Error(`unexpected script: ${s.slice(0, 40)}`);
            }),
        };
    }

    it('registers persistent with adapter-owned navigation', () => {
        const cmd = getCommand();
        expect(cmd).toBeDefined();
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.siteSession).toBe('persistent');
    });

    it('navigates with a PLAIN goto so a warm tab keeps the installed watcher', async () => {
        const page = makePage();
        page.getCurrentUrl = vi.fn().mockResolvedValue(ROOM_URL);
        await getCommand().func(page, { 'room-url': ROOM_URL, duration: 0 });
        expect(page.goto).toHaveBeenCalledWith(ROOM_URL);
        expect(page.evaluate).not.toHaveBeenCalledWith('location.reload()');
    });

    it('maps drained comments into rows', async () => {
        const page = makePage();
        const rows = await getCommand().func(page, { 'room-url': ROOM_URL, duration: 0 });
        expect(rows).toEqual([{ seq: 1, kind: 'chat', nickname: 'Joce1yn', msg: '好优雅' }]);
    });

    it('waits out --duration before draining', async () => {
        const page = makePage();
        await getCommand().func(page, { 'room-url': ROOM_URL, duration: 10 });
        const waited = page.wait.mock.calls.reduce((sum, [arg]) => sum + (arg?.time ?? arg ?? 0), 0);
        expect(waited).toBeGreaterThanOrEqual(10);
    });

    it('rejects durations beyond the command timeout budget', async () => {
        const page = makePage();
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, duration: 999 }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('accepts a bare room id', async () => {
        const page = makePage();
        await getCommand().func(page, { 'room-url': '570440812909234340', duration: 0 });
        expect(page.goto).toHaveBeenCalledWith('https://www.xiaohongshu.com/livestream/570440812909234340');
    });

    it('throws EMPTY_RESULT when nothing new arrived', async () => {
        const page = makePage({ drains: [{ installed: true, items: [] }] });
        await expect(getCommand().func(page, { 'room-url': ROOM_URL, duration: 0 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
});

describe('xiaohongshu/live-comments empty-drain diagnostics', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/live-comments');
    function makeEmptyPage(fresh) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                const s = String(script);
                if (s.includes('splice')) return { installed: true, items: [] };
                if (s.includes('__opencli_live_watch')) return { installed: true, fresh };
                throw new Error('unexpected script');
            }),
        };
    }

    it('tells the caller when an empty drain is due to a fresh install (watcher was lost)', async () => {
        await expect(getCommand().func(makeEmptyPage(true), { 'room-url': ROOM_URL, duration: 0 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: expect.stringContaining('freshly installed') });
    });

    it('tells the caller when the watcher survived but nothing new arrived', async () => {
        await expect(getCommand().func(makeEmptyPage(false), { 'room-url': ROOM_URL, duration: 0 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: expect.stringContaining('stayed alive') });
    });
});
