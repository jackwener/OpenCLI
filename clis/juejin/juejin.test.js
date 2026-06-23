import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

describe('juejin adapter registry contracts', () => {
    it('declares overlapping article_id columns so recommend and hot rows share a shape', () => {
        const recommend = getRegistry().get('juejin/recommend');
        const hot = getRegistry().get('juejin/hot');

        expect(recommend).toBeDefined();
        expect(hot).toBeDefined();
        expect(recommend.columns).toContain('article_id');
        expect(hot.columns).toContain('article_id');
        expect(recommend.columns).toContain('url');
        expect(hot.columns).toContain('url');
    });

    it('marks every command as read access on the api.juejin.cn domain', () => {
        for (const name of ['recommend', 'hot']) {
            const cmd = getRegistry().get(`juejin/${name}`);
            expect(cmd, name).toBeDefined();
            expect(cmd.access, name).toBe('read');
            expect(cmd.domain, name).toBe('api.juejin.cn');
            expect(cmd.browser, name).toBe(false);
        }
    });
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

    it('rejects invalid arguments before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: '1e2' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: ' 1 ' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: '01' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: 1, cursor: '1e2' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ limit: 1, cursor: ' 0 ' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps empty feed responses to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ err_no: 0, data: [] })));

        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('fails closed when recommend payload lacks a data array', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ err_no: 0 })));

        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
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

    it('surfaces Juejin err_no envelopes as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ err_no: 2, err_msg: '参数错误' })));

        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('surfaces HTTP and JSON parser failures as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 502 })));
        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })));
        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when the API envelope is missing err_no', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })));

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

    it('returns ranked rows using the content / content_counter / author envelope', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            err_no: 0,
            data: [{
                content: {
                    content_id: '7653666093677314057',
                    title: 'Hot Article One',
                    brief: 'Hot blurb',
                },
                content_counter: { view: 12000, like: 340, comment_count: 50, hot_rank: 9876 },
                author: { name: 'SimonKing' },
            }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ limit: 1 })).resolves.toEqual([{
            rank: 1,
            article_id: '7653666093677314057',
            title: 'Hot Article One',
            brief: 'Hot blurb',
            views: 12000,
            likes: 340,
            comments: 50,
            hot_rank: 9876,
            author: 'SimonKing',
            url: 'https://juejin.cn/post/7653666093677314057',
        }]);
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('category_id=6809637769959178254');
    });

    it('resolves a friendly category slug to the matching numeric id', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ err_no: 0, data: [] }));
        vi.stubGlobal('fetch', fetchMock);

        await command.func({ category: 'ai', limit: 1 }).catch(() => { /* EmptyResult check is not the point here */ });
        expect(fetchMock.mock.calls[0][0]).toContain('category_id=6809637773935378440');
    });

    it('rejects unknown category slugs before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ category: 'nonsense', limit: 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ category: 'backend', limit: '1e2' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ category: 'backend', limit: ' 1 ' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ category: 'backend', limit: '01' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps empty hot responses to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ err_no: 0, data: [] })));

        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('fails closed when hot payload lacks a data array', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ err_no: 0, data: null })));

        await expect(command.func({ limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when a hot row lacks a round-trippable article id', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            err_no: 0,
            data: [{ content: { content_id: '' }, content_counter: {}, author: {} }],
        })));

        await expect(command.func({ limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
