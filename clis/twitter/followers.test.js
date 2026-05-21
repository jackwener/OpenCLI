import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__ } from './followers.js';

describe('twitter followers command', () => {
    it('normalizes exact profile handles and rejects route-like hrefs', () => {
        expect(__test__.normalizeScreenName('@viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('/viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('https://x.com/viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('/home')).toBe('');
        expect(__test__.normalizeScreenName('/viewer/extra')).toBe('');
    });

    it('rejects invalid explicit users before navigation', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(command.func(page, { user: 'viewer/extra', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.wait).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects non-profile AppTabBar hrefs instead of navigating to route followers', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                if (String(script).includes('AppTabBar_Profile_Link')) return '/home';
                throw new Error(`Unexpected evaluate: ${String(script).slice(0, 80)}`);
            }),
        };

        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.goto).not.toHaveBeenCalledWith('https://x.com/home/followers');
    });

    it('typed-fails instead of throwing "filter is not a function" when extractFollowersFromDOM returns a non-array', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            autoScroll: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                const text = String(script);
                if (text.includes('AppTabBar_Profile_Link')) return '/viewer';
                if (text.includes('/followers') && text.includes('click')) return true;
                if (text.includes('UserCell')) return undefined;
                return undefined;
            }),
        };

        await expect(command.func(page, { user: 'someone', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
