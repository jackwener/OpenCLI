import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
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
    it('registers the hashtag command', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
        expect(cmd).toBeDefined();
        expect(cmd?.args.some(a => a.name === 'action')).toBe(true);
    });
    it('has all expected args', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
        const argNames = cmd?.args.map(a => a.name) ?? [];
        expect(argNames).toContain('action');
        expect(argNames).toContain('keyword');
        expect(argNames).toContain('cover');
        expect(argNames).toContain('limit');
    });
    it('uses COOKIE strategy', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'hashtag');
        expect(cmd?.strategy).toBe('cookie');
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

    it('hot accepts empty --keyword (it is optional for hot)', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({ hotspot_list: [{ sentence: '热点1', hot_value: 100, sentence_id: 'h1' }] });
        const rows = await cmd.func({}, { action: 'hot', keyword: '', cover: '', limit: 5 });
        expect(rows[0]).toEqual({ name: '热点1', id: 'h1', view_count: 100 });
        const url = browserFetchMock.mock.calls[0][2];
        expect(url).not.toContain('keyword=');
    });

    it('search threads --keyword + count into the challenge/search URL', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({
            challenge_list: [{ challenge_info: { cha_name: '美食', cid: '123', view_count: 5000 } }],
        });
        const rows = await cmd.func({}, { action: 'search', keyword: '美食', cover: '', limit: 10 });
        expect(rows).toEqual([{ name: '美食', id: '123', view_count: 5000 }]);
        const url = browserFetchMock.mock.calls[0][2];
        expect(url).toContain('challenge/search');
        expect(url).toContain('keyword=' + encodeURIComponent('美食'));
        expect(url).toContain('count=10');
    });

    it('suggest threads --cover into the hashtag/rec URL on success', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({
            hashtag_list: [{ name: '推荐话题', id: 'h99', view_count: 1234 }],
        });
        const rows = await cmd.func({}, { action: 'suggest', keyword: '', cover: 'tos-cn-i-cover/abc', limit: 10 });
        expect(rows).toEqual([{ name: '推荐话题', id: 'h99', view_count: 1234 }]);
        const url = browserFetchMock.mock.calls[0][2];
        expect(url).toContain('hashtag/rec');
        expect(url).toContain('cover_uri=' + encodeURIComponent('tos-cn-i-cover/abc'));
    });

    it('search throws CommandExecutionError when API returns a non-object payload', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce(null);
        await expect(cmd.func({}, { action: 'search', keyword: '美食', cover: '', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('search throws CommandExecutionError when challenge_list has wrong shape', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({ challenge_list: 'not-an-array' });
        await expect(cmd.func({}, { action: 'search', keyword: '美食', cover: '', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('search throws CommandExecutionError when challenges return but none parse', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({
            challenge_list: [{ challenge_info: null }, { other_field: 1 }],
        });
        await expect(cmd.func({}, { action: 'search', keyword: '美食', cover: '', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('suggest throws CommandExecutionError when hashtag_list has wrong shape', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({ hashtag_list: 'oops' });
        await expect(cmd.func({}, { action: 'suggest', keyword: '', cover: 'tos-cn-i-cover/x', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('hot throws CommandExecutionError when hotspot_list has wrong shape', async () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'hashtag');
        browserFetchMock.mockResolvedValueOnce({ hotspot_list: { malformed: true } });
        await expect(cmd.func({}, { action: 'hot', keyword: '', cover: '', limit: 5 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('parses the current hotspot recommendation shape', async () => {
        const registry = getRegistry();
        const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'hashtag');
        expect(command?.func).toBeDefined();
        if (!command?.func)
            throw new Error('douyin hashtag command not registered');
        browserFetchMock.mockResolvedValueOnce({
            all_sentences: [
                {
                    word: '在公园花海里大晒一场',
                    hot_value: 12141172,
                    sentence_id: '2448416',
                },
            ],
        });
        const rows = await command.func({}, { action: 'hot', keyword: '', limit: 5 });
        expect(rows).toEqual([
            {
                name: '在公园花海里大晒一场',
                id: '2448416',
                view_count: 12141172,
            },
        ]);
    });
});
