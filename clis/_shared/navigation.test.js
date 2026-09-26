import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './navigation.js';

const { isNavigationRejected, gotoWithRecovery } = __test__;

const rejected = () => new Error('Navigation rejected: tab did not navigate');
const other = () => new Error('Timeout: page took too long');

function makePage(gotoBehaviors, { newTabId = 'page-2', exposeRecovery = true } = {}) {
    let i = 0;
    const page = {
        goto: vi.fn().mockImplementation(() => {
            const behavior = gotoBehaviors[Math.min(i++, gotoBehaviors.length - 1)];
            return behavior === 'ok' ? Promise.resolve() : Promise.reject(behavior());
        }),
    };
    if (exposeRecovery) {
        page.closeWindow = vi.fn().mockResolvedValue(undefined);
        page.newTab = vi.fn().mockResolvedValue(newTabId);
        page.setActivePage = vi.fn().mockResolvedValue(undefined);
    }
    return page;
}

describe('shared navigation isNavigationRejected', () => {
    it('matches the bridge rejection message only', () => {
        expect(isNavigationRejected(rejected())).toBe(true);
        expect(isNavigationRejected(new Error('some Navigation rejected. detail'))).toBe(true);
        expect(isNavigationRejected(other())).toBe(false);
        expect(isNavigationRejected('Navigation rejected')).toBe(true);
        expect(isNavigationRejected(null)).toBe(false);
    });
});

describe('shared navigation gotoWithRecovery', () => {
    const url = 'https://example.com/page';

    it('navigates directly without touching recovery primitives', async () => {
        const page = makePage(['ok']);
        await expect(gotoWithRecovery(page, url)).resolves.toBeUndefined();
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.closeWindow).not.toHaveBeenCalled();
        expect(page.newTab).not.toHaveBeenCalled();
    });

    it('recovers a single rejection via closeWindow + retry', async () => {
        const page = makePage([rejected, 'ok']);
        await expect(gotoWithRecovery(page, url)).resolves.toBeUndefined();
        expect(page.closeWindow).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.newTab).not.toHaveBeenCalled();
    });

    it('falls through to newTab + setActivePage when both gotos reject', async () => {
        const page = makePage([rejected, rejected]);
        await expect(gotoWithRecovery(page, url)).resolves.toBeUndefined();
        expect(page.closeWindow).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.newTab).toHaveBeenCalledWith(url);
        expect(page.setActivePage).toHaveBeenCalledWith('page-2');
    });

    it('rethrows the rejection when newTab yields no page id', async () => {
        const page = makePage([rejected, rejected], { newTabId: null });
        await expect(gotoWithRecovery(page, url)).rejects.toThrow(/Navigation rejected/);
        expect(page.setActivePage).not.toHaveBeenCalled();
    });

    it('rethrows the rejection when the page handle lacks recovery primitives', async () => {
        const page = makePage([rejected, rejected], { exposeRecovery: false });
        await expect(gotoWithRecovery(page, url)).rejects.toThrow(/Navigation rejected/);
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('swallows closeWindow failures and still retries', async () => {
        const page = makePage([rejected, 'ok']);
        page.closeWindow = vi.fn().mockRejectedValue(new Error('window already gone'));
        await expect(gotoWithRecovery(page, url)).resolves.toBeUndefined();
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('propagates non-rejection errors immediately without recovery', async () => {
        const page = makePage([other, 'ok']);
        await expect(gotoWithRecovery(page, url)).rejects.toThrow(/Timeout/);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.closeWindow).not.toHaveBeenCalled();
    });
});
