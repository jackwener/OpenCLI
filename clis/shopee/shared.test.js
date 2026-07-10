import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test__ } from './shared.js';
describe('shopee shared humanization helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('builds a pointer simulation script for the target selector', () => {
        const script = __test__.buildHumanPointerScript('.target-button');
        expect(script).toContain('.target-button');
        expect(script).toContain('mousemove');
        expect(script).toContain('scrollIntoView');
    });
    it('builds a pointer-away script that blurs focus and emits a two-step leave trajectory', () => {
        const script = __test__.buildHumanPointerAwayScript('.target-button');
        expect(script).toContain('.target-button');
        expect(script).toContain('blur()');
        expect(script).toContain('mouseleave');
        expect(script).toContain('elementFromPoint');
        expect(script).toContain('waypoints');
        expect(script).toContain('midClientX');
        expect(script).toContain('finalClientX');
    });
    it('builds a localStorage clearing script scoped to the target host', () => {
        const script = __test__.buildClearLocalStorageScript('shopee.sg');
        expect(script).toContain('shopee.sg');
        expect(script).toContain('localStorage.clear()');
        expect(script).toContain('host_mismatch');
    });
    it('builds a Shopdora login-state reader for both hard and soft login markers', () => {
        const script = __test__.buildReadShopdoraLoginStateScript();
        expect(script).toContain('.shopdoraLoginPage');
        expect(script).toContain('.pageDetailLoginTitle');
    });
    it('waits for a randomized duration within the provided range', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const wait = vi.fn().mockResolvedValue(undefined);
        const page = { wait };
        const seconds = await __test__.waitRandomDuration(page, [200, 600]);
        expect(seconds).toBe(0.4);
        expect(wait).toHaveBeenCalledWith({ time: 0.4 });
    });
    it('simulates lightweight human behavior around a selector', async () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.4)
            .mockReturnValueOnce(0.2)
            .mockReturnValueOnce(0.3)
            .mockReturnValueOnce(0.5);
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            scroll: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ ok: true }),
        };
        await __test__.simulateHumanBehavior(page, {
            selector: '.target-button',
            preWaitRangeMs: [200, 600],
            postWaitRangeMs: [100, 300],
            scrollRangePx: [100, 300],
        });
        expect(page.wait).toHaveBeenCalledTimes(2);
        expect(page.wait).toHaveBeenNthCalledWith(1, { time: 0.4 });
        expect(page.wait).toHaveBeenNthCalledWith(2, { time: 0.2 });
        expect(page.scroll).toHaveBeenCalledWith('down', 180);
        expect(page.scroll).toHaveBeenCalledWith('up', 58);
        expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('.target-button'));
    });
    it('moves the pointer away from the active selector before continuing', async () => {
        vi.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.4);
        const page = {
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ ok: true }),
        };
        await __test__.simulatePointerAway(page, '.target-button', {
            preWaitRangeMs: [100, 300],
            postWaitRangeMs: [200, 400],
        });
        expect(page.wait).toHaveBeenCalledTimes(2);
        expect(page.wait).toHaveBeenNthCalledWith(1, { time: 0.2 });
        expect(page.wait).toHaveBeenNthCalledWith(2, { time: 0.28 });
        expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('mouseleave'));
        expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('.target-button'));
    });
    it('navigates to the target origin before clearing localStorage for that host', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValue({ ok: true, host: 'shopee.sg' });
        const page = { goto, evaluate };
        await __test__.clearLocalStorageForUrlHost(page, 'https://shopee.sg/product-i.1.2');
        expect(goto).toHaveBeenCalledWith('https://shopee.sg', { waitUntil: 'load' });
        expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('localStorage.clear()'));
        expect(evaluate).toHaveBeenCalledWith(expect.stringContaining('shopee.sg'));
    });
    it('reads Shopdora login markers and maps them to a user-facing message', async () => {
        const evaluate = vi.fn().mockResolvedValue({
            hasShopdoraLoginPage: false,
            hasPageDetailLoginTitle: true,
        });
        const page = { evaluate };
        await expect(__test__.readShopdoraLoginState(page)).resolves.toEqual({
            hasShopdoraLoginPage: false,
            hasPageDetailLoginTitle: true,
            loginMessage: 'Shopdora 未登录',
        });
    });
    it('appends the Shopdora login message when present', () => {
        expect(__test__.appendShopdoraLoginMessage('Downloaded successfully.', 'Shopdora 未登录'))
            .toBe('Downloaded successfully. Shopdora 未登录。');
        expect(__test__.appendShopdoraLoginMessage('Downloaded successfully.', ''))
            .toBe('Downloaded successfully.');
    });
});
