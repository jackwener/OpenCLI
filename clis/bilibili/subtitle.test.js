import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const { mockApiGet } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
}));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './subtitle.js';
describe('bilibili subtitle', () => {
    const command = getRegistry().get('bilibili/subtitle');
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
    };
    beforeEach(() => {
        mockApiGet.mockReset();
        page.goto.mockClear();
        page.evaluate.mockReset();
    });

    // 帮助函数：第一发 apiGet（view）固定返 cid=123456 的 OK 响应
    const mockViewOk = (cid = 123456) =>
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { bvid: 'BV1GbXPBeEZm', cid } });

    it('throws AuthRequiredError when bilibili hides subtitles behind login', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: true,
                subtitle: { subtitles: [] },
            },
        });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toSatisfy(
            (err) => err instanceof AuthRequiredError && /login|登录/i.test(err.message),
        );
    });

    it('throws EmptyResultError when a video truly has no subtitles', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [] },
            },
        });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when view API returns non-zero code', async () => {
        // 番剧/地区限制等场景下 view API 也会返非零；之前路径走 SELECTOR 错，现在统一走 view 错
        mockApiGet.mockResolvedValueOnce({ code: -404, message: '啥都木有' });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('wraps view API fetch/json exceptions as CommandExecutionError', async () => {
        mockApiGet.mockRejectedValueOnce(new SyntaxError('Unexpected token <'));
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when view API succeeds but lacks cid', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { bvid: 'BV1GbXPBeEZm' /* no cid */ } });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(/cid/);
    });

    it('throws CommandExecutionError when player subtitle payload is malformed', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: { lan: 'zh-CN' } },
            },
        });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when player API returns a non-object payload', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce(null);
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);

        mockApiGet.mockReset();
        mockViewOk();
        mockApiGet.mockResolvedValueOnce([]);
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws AuthRequiredError only for explicit empty subtitle_url entries', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '' }] },
            },
        });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(AuthRequiredError);
    });

    it('throws CommandExecutionError when subtitle entry lacks subtitle_url field', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [{ lan: 'zh-CN' }] },
            },
        });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('wraps subtitle file fetch exceptions as CommandExecutionError', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//example.com/sub.json' }] },
            },
        });
        page.evaluate.mockRejectedValueOnce(new Error('Failed to fetch'));
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when subtitle file has no cue rows', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//example.com/sub.json' }] },
            },
        });
        page.evaluate.mockResolvedValueOnce({ success: true, data: [] });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when subtitle cue rows have malformed time ranges', async () => {
        mockViewOk();
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: '//example.com/sub.json' }] },
            },
        });
        page.evaluate.mockResolvedValueOnce({ success: true, data: [{ from: 'bad', to: 1.5, content: 'hello' }] });
        await expect(command.func(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(CommandExecutionError);
    });

    it('works for bangumi-bound bvid (PGC content) — same code path, view API returns cid + redirect_url', async () => {
        // 回归保护：以前 page.goto(/video/<bvid>) 对 bangumi 走重定向，
        // window.__INITIAL_STATE__.videoData 不存在 → SELECTOR 错。view API 不依赖页面结构，bangumi 同样能拿 cid。
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                bvid: 'BV1Py4y1D781',
                cid: 267270412,
                redirect_url: 'https://www.bilibili.com/bangumi/play/ep371508',
                title: '【纪录片】灭绝的真相',
            },
        });
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                need_login_subtitle: false,
                subtitle: {
                    subtitles: [{ lan: 'zh-CN', subtitle_url: '//example.com/sub.json' }],
                },
            },
        });
        page.evaluate.mockResolvedValueOnce({
            success: true,
            data: [
                { from: 0, to: 1.5, content: 'hello' },
                { from: 1.5, to: 3.2, content: 'world' },
            ],
        });
        const out = await command.func(page, { bvid: 'BV1Py4y1D781' });
        expect(out).toEqual([
            { index: 1, from: '0.00s', to: '1.50s', content: 'hello' },
            { index: 2, from: '1.50s', to: '3.20s', content: 'world' },
        ]);
        // 关键：不再依赖 page.goto，所有 cid 解析走 apiGet
        expect(page.goto).not.toHaveBeenCalled();
        // 第一发 apiGet 一定是 view 端点
        const firstCall = mockApiGet.mock.calls[0];
        expect(firstCall[1]).toBe('/x/web-interface/view');
        expect(firstCall[2]?.params?.bvid).toBe('BV1Py4y1D781');
    });
});
