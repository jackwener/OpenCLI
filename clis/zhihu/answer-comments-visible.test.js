import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readVisibleComments, visibleCommentSnapshot } from './answer-comments-visible.js';

function fixture(extra = '') {
    const dom = new JSDOM(`<title>Answer</title><div class="AnswerItem" name="20"><button>3 条评论</button></div>${extra}`,
        { url: 'https://www.zhihu.com/question/10/answer/20', runScripts: 'outside-only' });
    dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    let clicks = 0;
    dom.window.document.querySelector('button').onclick = event => {
        clicks++; event.target.textContent = '收起评论';
        dom.window.document.body.insertAdjacentHTML('beforeend', `<div class="Modal-content">3 条评论
          <div data-id="100"><a href="/people/test">Example</a><div class="CommentContent">Root</div><button>展开 2 条回复</button>
            <div data-id="101"><div class="CommentContent">Visible reply</div></div></div>
          <div data-id="200"><div class="CommentContent"><img></div></div>
          <div data-id="300" hidden><div class="CommentContent">Hidden</div></div></div>`);
    };
    dom.window.fetch = vi.fn(() => { throw new Error('No API calls allowed'); });
    const page = { goto: vi.fn(), evaluate: vi.fn(async (fn, args) => {
        dom.window.__args = args;
        return dom.window.eval(`(${fn.toString()})(__args)`);
    }) };
    return { dom, page, clicks: () => clicks };
}

describe('visible answer comments', () => {
    it('accepts the page metadata identity when legacy answer attributes are absent', async () => {
        const f = fixture(), answer = f.dom.window.document.querySelector('.AnswerItem');
        answer.removeAttribute('name'); answer.setAttribute('data-zop', JSON.stringify({ itemId: '20' }));
        expect((await readVisibleComments(f.page, { id: '20' }))[0].id).toBe('100');
    });
    it('clicks once, preserves source/parent, excludes hidden rows and reports partial scope', async () => {
        const f = fixture();
        const rows = await readVisibleComments(f.page, { id: '20', limit: 2, 'replies-limit': 1 });
        expect(rows.map(row => row.id)).toEqual(['100', '101', '200']);
        expect(rows[1]).toMatchObject({ parent_id: '100', depth: 1 });
        expect(rows[0].has_unexpanded_replies).toBe(true);
        expect(rows[2].content_kind).toBe('non_text');
        expect(rows.every(row => row.complete === false && row.order === 'page_default')).toBe(true);
        expect(f.clicks()).toBe(1); expect(f.dom.window.fetch).not.toHaveBeenCalled();
    });
    it('does not expand or return replies when disabled', async () => {
        const f = fixture();
        expect((await readVisibleComments(f.page, { id: '20', 'replies-limit': 0 })).map(row => row.id)).toEqual(['100', '200']);
        expect(f.clicks()).toBe(1);
    });
    it.each(['<div role="dialog">安全验证</div>', '<div class="Modal-content">Other discussion</div>'])('stops before clicking an unsafe/unowned panel', async extra => {
        const f = fixture(extra);
        await expect(readVisibleComments(f.page, { id: '20' })).rejects.toThrow(/stopped/);
        expect(f.clicks()).toBe(0); expect(f.dom.window.fetch).not.toHaveBeenCalled();
    });
    it('rejects source changes and duplicate comment identity', async () => {
        const f = fixture();
        expect(await f.page.evaluate(visibleCommentSnapshot, { answerId: '21' })).toMatchObject({ error: 'answer_source_mismatch' });
        await f.page.evaluate(visibleCommentSnapshot, { answerId: '20', open: true });
        f.dom.window.document.querySelector('.Modal-content').insertAdjacentHTML('beforeend', '<div data-id="100"><div class="CommentContent">Other</div></div>');
        expect(await f.page.evaluate(visibleCommentSnapshot, { answerId: '20' })).toMatchObject({ error: 'invalid_or_duplicate_comment_id' });
    });
    it.each([{ id: 'https://example.org/20' }, { id: '20', limit: 21 }, { id: '20', 'replies-limit': -1 }])('validates input before navigation', async args => {
        const f = fixture(); await expect(readVisibleComments(f.page, args)).rejects.toThrow();
        expect(f.page.goto).not.toHaveBeenCalled();
    });
});
