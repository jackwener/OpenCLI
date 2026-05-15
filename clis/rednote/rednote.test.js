import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadMedia, mockFormatCookieHeader } = vi.hoisted(() => ({
    mockDownloadMedia: vi.fn(),
    mockFormatCookieHeader: vi.fn(() => 'sid=secret'),
}));

vi.mock('@jackwener/opencli/download/media-download', () => ({
    downloadMedia: mockDownloadMedia,
}));

vi.mock('@jackwener/opencli/download', () => ({
    formatCookieHeader: mockFormatCookieHeader,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './comments.js';
import './download.js';
import './feed.js';
import './notifications.js';
import './note.js';
import './search.js';
import './user.js';

function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        wait: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([{ name: 'sid', value: 'secret', domain: 'www.rednote.com' }]),
    };
}
function createSearchPageMock(evaluateResults) {
    const page = createPageMock(undefined);
    page.evaluate = vi.fn();
    for (const result of evaluateResults) {
        page.evaluate.mockResolvedValueOnce(result);
    }
    return page;
}

describe('rednote note URL identity', () => {
    const download = getRegistry().get('rednote/download');
    const comments = getRegistry().get('rednote/comments');

    beforeEach(() => {
        mockDownloadMedia.mockReset();
        mockDownloadMedia.mockResolvedValue([{ index: 1, type: 'image', status: 'success', size: '1 KB' }]);
        mockFormatCookieHeader.mockClear();
    });

    it('rejects xhslink short links before browser navigation', async () => {
        const page = createPageMock({ media: [] });
        await expect(download.func(page, {
            'note-id': 'https://xhslink.com/o/4MKEjsZnhCz',
            output: './out',
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('rednote.com'),
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });

    it('rejects signed xiaohongshu URLs before browser navigation', async () => {
        const page = createPageMock({ media: [] });
        await expect(comments.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc',
            limit: 20,
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('rednote.com'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('uses URL-scoped rednote cookies when downloading media', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: [{ type: 'image', url: 'https://ci.rednote.com/example.jpg' }],
        });
        await download.func(page, {
            'note-id': 'https://www.rednote.com/search_result/69bc166f000000001a02069a?xsec_token=abc',
            output: './out',
        });
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://www.rednote.com' });
        expect(mockDownloadMedia).toHaveBeenCalledWith([{ type: 'image', url: 'https://ci.rednote.com/example.jpg' }], expect.objectContaining({
            cookies: 'sid=secret',
            subdir: '69bc166f000000001a02069a',
        }));
    });

    it('throws empty-result instead of returning a failed success row when no media exists', async () => {
        const page = createPageMock({ noteId: '69bc166f000000001a02069a', media: [] });
        let caught;
        try {
            await download.func(page, {
                'note-id': 'https://www.rednote.com/search_result/69bc166f000000001a02069a?xsec_token=abc',
                output: './out',
            });
        }
        catch (error) {
            caught = error;
        }
        expect(caught).toMatchObject({ code: 'EMPTY_RESULT' });
        expect(caught?.hint).toContain('No downloadable media');
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });
});

describe('rednote argument validation', () => {
    const comments = getRegistry().get('rednote/comments');
    const feed = getRegistry().get('rednote/feed');
    const notifications = getRegistry().get('rednote/notifications');
    const user = getRegistry().get('rednote/user');

    it.each([
        ['rednote/comments', comments, { 'note-id': 'https://www.rednote.com/search_result/69aadbcb000000002202f131?xsec_token=abc', limit: 0 }],
        ['rednote/feed', feed, { limit: 0 }],
        ['rednote/notifications', notifications, { limit: 0 }],
        ['rednote/user', user, { id: 'user123', limit: 0 }],
    ])('%s rejects invalid --limit before browser navigation', async (_name, command, kwargs) => {
        const page = createPageMock({});
        await expect(command.func(page, kwargs)).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects unknown notification types before browser navigation', async () => {
        const page = createPageMock({});
        await expect(notifications.func(page, { type: 'all', limit: 20 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('--type'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('rednote search browser-bridge envelopes', () => {
    const search = getRegistry().get('rednote/search');

    it('unwraps login-wall wait result envelopes before auth handling', async () => {
        const page = createSearchPageMock([
            { session: 'site:rednote', data: 'login_wall' },
        ]);

        await expect(search.func(page, { query: 'tesla', limit: 5 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: expect.stringContaining('blocked behind a login wall'),
        });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('unwraps search extraction envelopes and preserves rednote row shape', async () => {
        const url = 'https://www.rednote.com/search_result/68e90be80000000004022e66?xsec_token=test-token';
        const page = createSearchPageMock([
            'content',
            1,
            {
                session: 'site:rednote',
                data: [{
                    title: 'rednote result',
                    author: 'author',
                    likes: '12',
                    url,
                    author_url: 'https://www.rednote.com/user/profile/u1',
                }],
            },
        ]);

        await expect(search.func(page, { query: 'tesla', limit: 1 })).resolves.toEqual([{
            rank: 1,
            title: 'rednote result',
            author: 'author',
            likes: '12',
            published_at: '2025-10-10',
            url,
            author_url: 'https://www.rednote.com/user/profile/u1',
        }]);
    });

    it('fails typed instead of silently returning [] for malformed extraction payloads', async () => {
        const page = createSearchPageMock([
            'content',
            1,
            { session: 'site:rednote', data: { rows: [] } },
        ]);

        await expect(search.func(page, { query: 'tesla', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('payload shape'),
        });
    });
});

describe('rednote Pinia store failures', () => {
    it('maps feed store read failure to CommandExecutionError', async () => {
        const command = getRegistry().get('rednote/feed');
        const page = createPageMock({ error: 'no_pinia' });
        await expect(command.func(page, { limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('no_pinia'),
        });
    });

    it('maps notification action failure to CommandExecutionError', async () => {
        const command = getRegistry().get('rednote/notifications');
        const page = createPageMock({ error: 'action_failed', detail: 'blocked' });
        await expect(command.func(page, { type: 'mentions', limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('action_failed'),
        });
    });

    it('allows an empty notification list after a successful store read', async () => {
        const command = getRegistry().get('rednote/notifications');
        const page = createPageMock({ items: [] });
        await expect(command.func(page, { type: 'mentions', limit: 20 })).resolves.toEqual([]);
    });
});
