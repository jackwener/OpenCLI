import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
const { browserFetchMock } = vi.hoisted(() => ({
    browserFetchMock: vi.fn(),
}));
vi.mock('./_shared/browser-fetch.js', () => ({
    browserFetch: browserFetchMock,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './hashtag.js';
describe('douyin hashtag', () => {
    beforeEach(() => {
        browserFetchMock.mockReset();
    });

    it('registers action-specific validation so missing args fail before browser pre-navigation', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        expect(cmd?.validateArgs).toBeTypeOf('function');
        expect(() => cmd.validateArgs({ action: 'search', keyword: '', cover: '', limit: 10 }))
            .toThrow(ArgumentError);
        expect(() => cmd.validateArgs({ action: 'suggest', keyword: '速效救心丸', cover: '', limit: 10 }))
            .toThrow(ArgumentError);
        expect(() => cmd.validateArgs({ action: 'hot', keyword: '', cover: '', limit: 10 }))
            .not.toThrow();
        expect(browserFetchMock).not.toHaveBeenCalled();
    });

    it('search throws ArgumentError when --keyword is missing or blank (#1689)', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        await expect(cmd.func({}, { action: 'search', keyword: '', cover: '', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({}, { action: 'search', keyword: '   ', cover: '', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(browserFetchMock).not.toHaveBeenCalled();
    });

    it('suggest throws ArgumentError when --cover is missing (#1689 root cause)', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        await expect(cmd.func({}, { action: 'suggest', keyword: '速效救心丸', cover: '', limit: 10 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--cover') });
        await expect(cmd.func({}, { action: 'suggest', keyword: '', cover: '   ', limit: 10 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(browserFetchMock).not.toHaveBeenCalled();
    });

});
