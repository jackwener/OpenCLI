import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './recommend.js';
import './hot.js';

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('juejin recommend command', () => {
    const command = getRegistry().get('juejin/recommend');

    it('returns feed rows whose article_id round-trips into a juejin.cn post URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            err_no: 0,
            cursor: '20',
            has_more: true,
            data: [{
                item_info: {
                    article_info: {
                        article_id: '7650882103059939337',
                        title: 'Sample Feed Article',
                        brief_content: 'A short blurb',
                        view_count: 4236,
                        digg_count: 7,
                        comment_count: 3,
                    },
                    author_user_info: { user_name: '神奇小汤圆' },
                    tags: [{ tag_name: '后端' }, { tag_name: 'AI' }],
                },
            }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ limit: 1, cursor: '0' })).resolves.toEqual([{
            rank: 1,
            article_id: '7650882103059939337',
            title: 'Sample Feed Article',
            brief: 'A short blurb',
            views: 4236,
            likes: 7,
            comments: 3,
            author: '神奇小汤圆',
            tags: '后端, AI',
            url: 'https://juejin.cn/post/7650882103059939337',
            next_cursor: '20',
            has_more: 'true',
        }]);
        const init = fetchMock.mock.calls[0][1];
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({ limit: 1, cursor: '0' });
    });

    it('fails closed on malformed pagination metadata', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
            err_no: 0,
            cursor: '1e2',
            data: [{ item_info: { article_info: { article_id: '7650882103059939337', title: 'ok' } } }],
        })));
        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
            err_no: 0,
            has_more: 'yes',
            data: [{ item_info: { article_info: { article_id: '7650882103059939337', title: 'ok' } } }],
        })));
        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
            err_no: 0,
            has_more: true,
            data: [{ item_info: { article_info: { article_id: '7650882103059939337', title: 'ok' } } }],
        })));
        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when a recommend row lacks a round-trippable article id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            err_no: 0,
            data: [{ item_info: { article_info: { article_id: 'bad-id', title: 'Bad' } } }],
        })));

        await expect(command.func({ limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('juejin hot command', () => {
    const command = getRegistry().get('juejin/hot');

    it('fails closed when a hot row lacks a round-trippable article id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            err_no: 0,
            data: [{ content: { content_id: '' }, content_counter: {}, author: {} }],
        })));

        await expect(command.func({ limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
