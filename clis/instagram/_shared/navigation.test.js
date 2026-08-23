import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTAGRAM_HOME_URL, gotoInstagramHome } from './navigation.js';

function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('instagram navigation helpers', () => {
    it('exports the canonical instagram home URL', () => {
        expect(INSTAGRAM_HOME_URL).toBe('https://www.instagram.com/');
    });

    it('navigates to instagram home once by default', async () => {
        const page = createPageMock();
        await gotoInstagramHome(page);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.instagram.com/');
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('forces a reset URL before the final instagram home navigation', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
        const page = createPageMock();

        await gotoInstagramHome(page, true);

        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.instagram.com/?__opencli_reset=1700000000000');
        expect(page.wait).toHaveBeenCalledTimes(1);
        expect(page.wait).toHaveBeenNthCalledWith(1, { time: 1 });
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.instagram.com/');
        expect(page.goto.mock.invocationCallOrder[0]).toBeLessThan(page.wait.mock.invocationCallOrder[0]);
        expect(page.wait.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[1]);
    });
});
