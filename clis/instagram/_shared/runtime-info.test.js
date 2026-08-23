import { describe, expect, it, vi } from 'vitest';
import { resolveCurrentUserId } from './runtime-info.js';

describe('instagram runtime info helpers', () => {
    it('reads the current user id from instagram cookies', async () => {
        const page = {
            getCookies: vi.fn().mockResolvedValue([
                { name: 'sessionid', value: 'session', domain: 'instagram.com' },
                { name: 'ds_user_id', value: '123456789', domain: 'instagram.com' },
                { name: 'csrftoken', value: 'csrf', domain: 'instagram.com' },
            ]),
        };

        await expect(resolveCurrentUserId(page)).resolves.toBe('123456789');
        expect(page.getCookies).toHaveBeenCalledTimes(1);
        expect(page.getCookies).toHaveBeenNthCalledWith(1, { domain: 'instagram.com' });
    });

    it('returns an empty string when the current user id cookie is missing', async () => {
        const page = {
            getCookies: vi.fn().mockResolvedValue([
                { name: 'sessionid', value: 'session', domain: 'instagram.com' },
                { name: 'csrftoken', value: 'csrf', domain: 'instagram.com' },
            ]),
        };

        await expect(resolveCurrentUserId(page)).resolves.toBe('');
        expect(page.getCookies).toHaveBeenCalledWith({ domain: 'instagram.com' });
    });

    it('returns an empty string when the current user id cookie value is empty', async () => {
        const page = {
            getCookies: vi.fn().mockResolvedValue([
                { name: 'ds_user_id', value: '', domain: 'instagram.com' },
            ]),
        };

        await expect(resolveCurrentUserId(page)).resolves.toBe('');
        expect(page.getCookies).toHaveBeenCalledWith({ domain: 'instagram.com' });
    });

    it('propagates getCookies failures', async () => {
        const error = new Error('cookies unavailable');
        const page = {
            getCookies: vi.fn().mockRejectedValue(error),
        };

        await expect(resolveCurrentUserId(page)).rejects.toBe(error);
        expect(page.getCookies).toHaveBeenCalledWith({ domain: 'instagram.com' });
    });
});
