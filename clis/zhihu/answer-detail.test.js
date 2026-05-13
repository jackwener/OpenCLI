import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import './answer-detail.js';
import { __test__ as helpers } from './answer-detail.js';

describe('zhihu answer-detail', () => {
    it('registers as a cookie read command', () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('read');
        expect(cmd.strategy).toBe('cookie');
    });

    it('fetches a single answer by numeric id and returns one row', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            // The adapter must call the `/api/v4/answers/<id>` endpoint
            // (not the question→answers listing) and request the rich
            // include set so the row carries content + counts + question.
            expect(js).toContain('/api/v4/answers/1937205528846655537?include=content');
            expect(js).toContain('voteup_count');
            expect(js).toContain('comment_count');
            expect(js).toContain('question');
            expect(js).toContain("credentials: 'include'");
            return {
                // Real Zhihu API returns `id` as a JSON number, which
                // *loses precision* in browser JSON.parse for ids
                // above 2^53 (Number.MAX_SAFE_INTEGER). The adapter
                // must not trust this field for the canonical id —
                // it must anchor the row id to the parsed input
                // instead. We pass a deliberately wrong value below
                // to lock that contract in.
                id: 0,
                author: { name: 'Ricky' },
                voteup_count: 1234,
                comment_count: 56,
                created_time: 1700000000,
                updated_time: 1700001000,
                content: '<p>这是<strong>第一段</strong></p><br/><p>第二段。</p>',
                question: { id: 630517537, title: '回想自己的人生阅历，你最想教给孩子们的一个道理是什么？' },
            };
        });
        const page = { goto, evaluate };
        const rows = await cmd.func(page, { id: '1937205528846655537', 'max-content': 0 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: '1937205528846655537',
            author: 'Ricky',
            votes: 1234,
            comments: 56,
            question_id: '630517537',
            question_title: '回想自己的人生阅历，你最想教给孩子们的一个道理是什么？',
            url: 'https://www.zhihu.com/question/630517537/answer/1937205528846655537',
            created_at: '2023-11-14T22:13:20.000Z',
            updated_at: '2023-11-14T22:30:00.000Z',
        });
        // Block-level tags should become real newlines, not be collapsed flat.
        expect(rows[0].content).toBe('这是第一段\n\n第二段。');
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com/answer/1937205528846655537');
    });

    it('accepts a full Zhihu answer URL as id, preserving full precision', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const evaluate = vi.fn().mockResolvedValue({
            // Same precision-loss trap as above: `data.id` from the
            // real API would round to `1937205528846655500`. Pass a
            // wrong value here to assert the adapter ignores it and
            // anchors to the parsed URL instead.
            id: 0,
            author: { name: 'Ricky' },
            voteup_count: 1,
            comment_count: 0,
            content: '<p>hello</p>',
            question: { id: 630517537, title: 'Q' },
        });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, {
            id: 'https://www.zhihu.com/question/630517537/answer/1937205528846655537',
            'max-content': 0,
        });
        expect(rows[0].id).toBe('1937205528846655537');
        expect(rows[0].url).toBe('https://www.zhihu.com/question/630517537/answer/1937205528846655537');
        expect(evaluate.mock.calls[0][0]).toContain('/api/v4/answers/1937205528846655537?');
    });

    it('accepts the typed-target form answer:<qid>:<aid>', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const evaluate = vi.fn().mockResolvedValue({
            id: 999,
            author: { name: 'bob' },
            voteup_count: 0,
            comment_count: 0,
            content: '<p>x</p>',
            question: { id: 111, title: 'Q' },
        });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, { id: 'answer:111:999', 'max-content': 0 });
        expect(rows[0].id).toBe('999');
        expect(rows[0].question_id).toBe('111');
        expect(evaluate.mock.calls[0][0]).toContain('/api/v4/answers/999?');
    });

    it('returns the full stripped body when --max-content is 0 (default)', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const longBody = 'x'.repeat(5000);
        const evaluate = vi.fn().mockResolvedValue({
            id: 1,
            author: { name: 'a' },
            voteup_count: 0,
            comment_count: 0,
            content: `<p>${longBody}</p>`,
            question: { id: 2, title: 'Q' },
        });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, { id: '1', 'max-content': 0 });
        expect(rows[0].content.length).toBe(5000);
    });

    it('respects --max-content as an opt-in cap', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const longBody = 'x'.repeat(5000);
        const evaluate = vi.fn().mockResolvedValue({
            id: 1,
            author: { name: 'a' },
            voteup_count: 0,
            comment_count: 0,
            content: `<p>${longBody}</p>`,
            question: { id: 2, title: 'Q' },
        });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, { id: '1', 'max-content': 100 });
        expect(rows[0].content.length).toBe(100);
    });

    it('falls back to bare /answer/<id> URL when the response is missing question metadata', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const evaluate = vi.fn().mockResolvedValue({
            id: 42,
            author: { name: 'alice' },
            voteup_count: 0,
            comment_count: 0,
            content: '<p>orphan answer</p>',
            // no `question` field at all
        });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, { id: '42', 'max-content': 0 });
        expect(rows[0].question_id).toBe('');
        expect(rows[0].question_title).toBe('');
        expect(rows[0].url).toBe('https://www.zhihu.com/answer/42');
    });

    it('maps 401/403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
        };
        await expect(cmd.func(page, { id: '1', 'max-content': 0 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps other HTTP failures to CliError FETCH_ERROR', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
        };
        await expect(cmd.func(page, { id: '1', 'max-content': 0 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu answer detail request failed (HTTP 500)',
        });
    });

    it('treats a null evaluate response as a fetch error', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(null),
        };
        await expect(cmd.func(page, { id: '1', 'max-content': 0 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu answer detail request failed',
        });
    });

    it('rejects non-numeric answer ids before navigation', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: "abc'; alert(1); //", 'max-content': 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects negative --max-content before navigation', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: '1', 'max-content': -5 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects unrelated URLs before navigation', async () => {
        const cmd = getRegistry().get('zhihu/answer-detail');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: 'https://example.com/foo/bar', 'max-content': 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('zhihu answer-detail helpers', () => {
    it('stripHtml drops tags and decodes common entities', () => {
        const out = helpers.stripHtml('<p>hi&nbsp;there &amp; you</p><p>second</p>');
        expect(out).toBe('hi there & you\n\nsecond');
    });

    it('stripHtml maps <br> to single newline', () => {
        expect(helpers.stripHtml('a<br>b<br/>c')).toBe('a\nb\nc');
    });

    it('extractAnswerId handles all three input shapes', () => {
        expect(helpers.extractAnswerId('123')).toBe('123');
        expect(helpers.extractAnswerId('answer:10:123')).toBe('123');
        expect(helpers.extractAnswerId('https://www.zhihu.com/question/10/answer/123')).toBe('123');
        expect(helpers.extractAnswerId('https://www.zhihu.com/answer/123')).toBe('123');
        expect(helpers.extractAnswerId('  123  ')).toBe('123');
        expect(helpers.extractAnswerId('')).toBeNull();
        expect(helpers.extractAnswerId('not-an-id')).toBeNull();
        expect(helpers.extractAnswerId('https://example.com/answer/123')).toBeNull();
    });
});
