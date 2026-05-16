import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import './profile.js';

describe('twitter profile command', () => {
    it('rejects invalid explicit usernames before navigation', async () => {
        const command = getRegistry().get('twitter/profile');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(command.func(page, { username: 'viewer/extra' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects route-like AppTabBar hrefs instead of navigating to that route profile', async () => {
        const command = getRegistry().get('twitter/profile');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(),
            evaluate: vi.fn(async (script) => {
                if (String(script).includes('AppTabBar_Profile_Link')) return '/home';
                throw new Error(`Unexpected evaluate: ${String(script).slice(0, 80)}`);
            }),
        };

        await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.getCookies).not.toHaveBeenCalled();
    });
});
