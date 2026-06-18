import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './user.js';
import { countFlatNotes, isLoginWallSnapshot, readUserSnapshotHydrated, assertReadableUserSnapshot, } from './user.js';

// 构造各类 user 快照（与 USER_SNAPSHOT_JS 返回形状一致）。
function snap(overrides = {}) {
    return {
        noteGroups: [],
        pageData: {},
        storePresent: true,
        notesPresent: true,
        pageDataPresent: true,
        loginWall: false,
        ...overrides,
    };
}
// 一条可被 extractXhsUserNotes 解析的笔记，包在 tab 分组里：notes = [tab[], ...]。
function noteEntry(id) {
    return { noteCard: { noteId: id, displayTitle: 't-' + id, type: 'normal', interactInfo: { likedCount: 3 } } };
}
const NOTES_SNAP = snap({ noteGroups: [[noteEntry('aaa')], [], []] });
const EMPTY_GROUPS_SNAP = snap({ noteGroups: [[], [], [], [], []] }); // store 在但笔记未填充
const LOGIN_WALL_SNAP = snap({ noteGroups: [[], [], [], [], []], loginWall: true });
const NO_STORE_SNAP = snap({ noteGroups: [], storePresent: false, notesPresent: false });

function createPageMock(evaluateImpl) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateImpl,
        wait: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
    };
}

describe('countFlatNotes', () => {
    it('5 个空 tab 分组 → 0', () => {
        expect(countFlatNotes(EMPTY_GROUPS_SNAP)).toBe(0);
    });
    it('嵌套数组求和', () => {
        expect(countFlatNotes(snap({ noteGroups: [[noteEntry('a'), noteEntry('b')], [noteEntry('c')]] }))).toBe(3);
    });
    it('非数组 / 缺字段 → 0', () => {
        expect(countFlatNotes({ noteGroups: null })).toBe(0);
        expect(countFlatNotes(null)).toBe(0);
    });
});

describe('isLoginWallSnapshot', () => {
    it('loginWall=true → true', () => {
        expect(isLoginWallSnapshot(LOGIN_WALL_SNAP)).toBe(true);
    });
    it('loginWall=false / 缺失 → false', () => {
        expect(isLoginWallSnapshot(NOTES_SNAP)).toBe(false);
        expect(isLoginWallSnapshot(snap({ loginWall: undefined }))).toBe(false);
        expect(isLoginWallSnapshot(null)).toBe(false);
    });
});

describe('readUserSnapshotHydrated', () => {
    it('快路径：首读即有笔记 → 不 wait、不重试', async () => {
        const page = createPageMock(vi.fn().mockResolvedValue(NOTES_SNAP));
        const out = await readUserSnapshotHydrated(page);
        expect(out).toBe(NOTES_SNAP);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.wait).not.toHaveBeenCalled();
    });
    it('慢加载：store/notes 晚到 → 重试直到笔记出现（回归 2026-06-09 hydration 竞态）', async () => {
        const page = createPageMock(vi
            .fn()
            .mockResolvedValueOnce(NO_STORE_SNAP) // goto 后立刻读：store 还没 hydrate
            .mockResolvedValueOnce(EMPTY_GROUPS_SNAP) // store 在了但 notes 空
            .mockResolvedValue(NOTES_SNAP)); // 笔记终于填充
        const out = await readUserSnapshotHydrated(page);
        expect(countFlatNotes(out)).toBe(1);
        expect(page.wait).toHaveBeenCalled(); // 确实等过
    });
    it('登录墙：命中即停，不浪费重试预算', async () => {
        const page = createPageMock(vi.fn().mockResolvedValue(LOGIN_WALL_SNAP));
        const out = await readUserSnapshotHydrated(page);
        expect(isLoginWallSnapshot(out)).toBe(true);
        expect(page.evaluate).toHaveBeenCalledTimes(1); // 没进重试循环
        expect(page.wait).not.toHaveBeenCalled();
    });
    it('真·空号：走满重试后返回空快照（交给下游 EmptyResultError）', async () => {
        const page = createPageMock(vi.fn().mockResolvedValue(EMPTY_GROUPS_SNAP));
        const out = await readUserSnapshotHydrated(page, 3, 0.01);
        expect(countFlatNotes(out)).toBe(0);
        expect(isLoginWallSnapshot(out)).toBe(false);
        expect(page.wait).toHaveBeenCalledTimes(3); // maxRetries 次
    });
});

describe('xiaohongshu user command', () => {
    const command = getRegistry().get('xiaohongshu/user');

    it('登录墙 → 抛 AUTH_REQUIRED（不再误报 Malformed/EMPTY）', async () => {
        const page = createPageMock(vi.fn().mockResolvedValue(LOGIN_WALL_SNAP));
        await expect(command.func(page, { id: '56d290df84edcd782a3c8748', limit: 5 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
        });
    });

    it('笔记晚到 → 重试后成功返回（端到端回归）', async () => {
        const page = createPageMock(vi
            .fn()
            .mockResolvedValueOnce(NO_STORE_SNAP)
            .mockResolvedValueOnce(EMPTY_GROUPS_SNAP)
            .mockResolvedValue(NOTES_SNAP));
        const rows = await command.func(page, { id: 'someuser', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('aaa');
    });

    it('滚动续读时被重定向到登录墙 → 抛 AUTH_REQUIRED', async () => {
        const page = createPageMock(vi
            .fn()
            .mockResolvedValueOnce(snap({ noteGroups: [[noteEntry('aaa')]] }))
            .mockResolvedValueOnce(LOGIN_WALL_SNAP));
        await expect(command.func(page, { id: 'someuser', limit: 5 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
        });
        expect(page.autoScroll).toHaveBeenCalledTimes(1);
    });

    it('真·空号 → 抛 EMPTY_RESULT', async () => {
        const page = createPageMock(vi.fn().mockResolvedValue(EMPTY_GROUPS_SNAP));
        await expect(command.func(page, { id: 'emptyuser', limit: 5 })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });
});

describe('assertReadableUserSnapshot (既有契约保持)', () => {
    it('storePresent=false → Malformed: user store was not found', () => {
        expect(() => assertReadableUserSnapshot(NO_STORE_SNAP)).toThrow(/user store was not found/);
    });
    it('正常快照不抛', () => {
        expect(() => assertReadableUserSnapshot(NOTES_SNAP)).not.toThrow();
    });
});
