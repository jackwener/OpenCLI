import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ai-outline.js';

describe('weread ai-outline', () => {
    const command = getRegistry().get('weread/ai-outline');

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('registers ai-outline with plain default output', () => {
        expect(command?.defaultFormat).toBe('plain');
    });

    it('maps chapterInfos auth-expired responses to AUTH_REQUIRED', async () => {
        expect(command?.func).toBeTypeOf('function');
        const page = {
            getCookies: vi.fn()
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid123', domain: '.weread.qq.com' }])
                .mockResolvedValueOnce([{ name: 'wr_name', value: 'alice', domain: '.weread.qq.com' }]),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        await expect(command.func(page, { 'book-id': 'book-1' })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: 'Not logged in to WeRead',
        });
    });

    it('returns structured rows for --raw and respects depth filtering', async () => {
        expect(command?.func).toBeTypeOf('function');
        const page = {
            getCookies: vi.fn()
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid123', domain: '.weread.qq.com' }])
                .mockResolvedValueOnce([{ name: 'wr_name', value: 'alice', domain: '.weread.qq.com' }]),
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                data: [{
                        updated: [
                            { chapterUid: 'c1', title: '第一章' },
                        ],
                    }],
            }),
        })
            .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                itemsArray: [{
                        chapterUid: 'c1',
                        items: [
                            { level: 2, uiIdx: '1', text: '主题一' },
                            { level: 3, uiIdx: '1.1', text: '要点一' },
                            { level: 4, text: '细节一' },
                        ],
                    }],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const rows = await command.func(page, { 'book-id': 'book-1', raw: true, depth: 3, limit: 10 });
        expect(rows).toEqual([
            { chapter: '第一章', idx: '1', level: 2, text: '主题一' },
            { chapter: '第一章', idx: '1.1', level: 3, text: '要点一' },
        ]);
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/book/chapterInfos', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                Cookie: 'wr_name=alice; wr_vid=vid123',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/book/outline', expect.objectContaining({
            method: 'POST',
        }));
    });
});
