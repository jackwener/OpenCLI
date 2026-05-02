import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

describe('weixin search command', () => {
    const command = getRegistry().get('weixin/search');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('weixin');
        expect(command.strategy).toBe('public');
        expect(command.browser).toBe(true);
    });

    it('rejects empty queries before browser navigation', async () => {
        const page = { goto: vi.fn() };

        await expect(command.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });

        expect(page.goto).not.toHaveBeenCalled();
    });

    it('uses page and limit while preserving per-page ranking', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([
                {
                    title: 'First article',
                    url: 'https://weixin.sogou.com/link?url=abc',
                    summary: 'First summary',
                    publish_time: '2小时前',
                },
                {
                    title: 'Second article',
                    url: 'https://weixin.sogou.com/link?url=def',
                    summary: 'Second summary',
                    publish_time: '1小时前',
                },
            ]),
        };

        const result = await command.func(page, { query: 'AI', page: 2, limit: 1 });

        expect(page.goto).toHaveBeenCalledWith('https://weixin.sogou.com/weixin?query=AI&type=2&page=2&ie=utf8');
        expect(result).toEqual([
            {
                rank: 11,
                page: 2,
                title: 'First article',
                url: 'https://weixin.sogou.com/link?url=abc',
                summary: 'First summary',
                publish_time: '2小时前',
            },
        ]);
    });

    it('preserves browser-side cleanup regex escapes', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([
                {
                    title: 'Article',
                    url: 'https://weixin.sogou.com/link?url=abc',
                    summary: 'Summary',
                    publish_time: '2024-4-28',
                },
            ]),
        };

        await command.func(page, { query: 'AI' });

        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain(".replace(/\\s+/g, ' ')");
        expect(script).toContain(".replace(/document\\.write\\(timeConvert\\('\\d+'\\)\\)/g, '')");
    });
});
