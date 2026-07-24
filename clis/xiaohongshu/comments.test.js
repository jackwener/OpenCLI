import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { buildCommentsExtractJs, buildXhsProfileUrl, parseXhsLikeCountText, parseXhsProfileHref } from './comments.js';
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}

async function runCommentsExtract(html, withReplies = false) {
    const dom = new JSDOM(html, { url: 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok' });
    const hadDocument = Object.hasOwn(globalThis, 'document');
    const hadLocation = Object.hasOwn(globalThis, 'location');
    const hadWindow = Object.hasOwn(globalThis, 'window');
    const hadHTMLElement = Object.hasOwn(globalThis, 'HTMLElement');
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    const previousWindow = globalThis.window;
    const previousHTMLElement = globalThis.HTMLElement;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    globalThis.window = dom.window;
    globalThis.HTMLElement = dom.window.HTMLElement;
    try {
        // limit=1 so the scroll-loading loop's initial "already have enough"
        // check short-circuits instead of burning through stall retries — the
        // JSDOM fixtures below are fully static, there's nothing more to load.
        return await eval(buildCommentsExtractJs(withReplies, 1));
    } finally {
        if (hadDocument) globalThis.document = previousDocument;
        else delete globalThis.document;
        if (hadLocation) globalThis.location = previousLocation;
        else delete globalThis.location;
        if (hadWindow) globalThis.window = previousWindow;
        else delete globalThis.window;
        if (hadHTMLElement) globalThis.HTMLElement = previousHTMLElement;
        else delete globalThis.HTMLElement;
        dom.window.close();
    }
}

describe('parseXhsLikeCountText', () => {
    it('parses exact integer and shortform like counts', () => {
        expect(parseXhsLikeCountText('0')).toBe(0);
        expect(parseXhsLikeCountText('42')).toBe(42);
        expect(parseXhsLikeCountText('1,234')).toBe(1234);
        expect(parseXhsLikeCountText('1，234+')).toBe(1234);
        expect(parseXhsLikeCountText('2.1w')).toBe(21000);
        expect(parseXhsLikeCountText('1.5万')).toBe(15000);
        expect(parseXhsLikeCountText('1.2k')).toBe(1200);
        expect(parseXhsLikeCountText('3千')).toBe(3000);
        expect(parseXhsLikeCountText(' 2.1 w + ')).toBe(21000);
    });

    it('returns 0 for unknown shapes without overparsing arbitrary text', () => {
        for (const raw of ['', null, undefined, '赞', 'likes 2.1w', '2w人', '1,23', '1.2.3k', '.', '1.5']) {
            expect(parseXhsLikeCountText(raw)).toBe(0);
        }
    });
});

describe('xiaohongshu comments', () => {
    const command = getRegistry().get('xiaohongshu/comments');
    it('restores JSDOM globals after DOM extraction', async () => {
        const keys = ['document', 'location', 'window', 'HTMLElement'];
        const before = keys.map(key => ({
            key,
            hadOwnProperty: Object.hasOwn(globalThis, key),
            value: Reflect.get(globalThis, key),
        }));

        await runCommentsExtract(`
          <main>
            <section class="parent-comment">
              <div class="comment-item">
                <span class="name">Alice</span>
                <div class="content">Root comment</div>
              </div>
            </section>
          </main>
        `);

        for (const entry of before) {
            expect(Object.hasOwn(globalThis, entry.key)).toBe(entry.hadOwnProperty);
            if (entry.hadOwnProperty) {
                expect(Reflect.get(globalThis, entry.key)).toBe(entry.value);
            }
        }
    });
    it('returns ranked comment rows for signed full URLs', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '' },
                { author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02', is_reply: false, reply_to: '' },
            ],
        });
        const signedUrl = 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search';
        const result = (await command.func(page, { 'note-id': signedUrl, limit: 5 }));
        expect(page.goto.mock.calls[0][0]).toBe(signedUrl);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ rank: 1, author: 'Alice', text: 'Great note!', likes: 10 });
        expect(result[1]).toMatchObject({ rank: 2, author: 'Bob', text: 'Very helpful', likes: 0 });
    });
    it('rejects bare note IDs before browser navigation', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await expect(command.func(page, { 'note-id': '69aadbcb000000002202f131', limit: 5 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('xsec_token'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('preserves signed /explore/ URL as-is for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search',
            limit: 5,
        });
        expect(page.goto.mock.calls[0][0]).toContain('/explore/69aadbcb000000002202f131?xsec_token=abc');
    });
    it('preserves full search_result URL with xsec_token for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search';
        await command.func(page, { 'note-id': fullUrl, limit: 5 });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('preserves signed /user/profile/<user>/<note> URLs for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/user/profile/user123/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_user';
        await command.func(page, { 'note-id': fullUrl, limit: 5 });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('throws AuthRequiredError when login wall is detected', async () => {
        const page = createPageMock({ loginWall: true, results: [] });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).rejects.toThrow('Note comments require login');
    });
    it('throws SECURITY_BLOCK with retry guidance when a full URL comments page is blocked', async () => {
        const page = createPageMock({
            pageUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300031',
            securityBlock: true,
            loginWall: false,
            results: [],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search',
            limit: 5,
        })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: expect.stringContaining('Try again later'),
        });
    });
    it('returns empty array when no comments are found', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).resolves.toEqual([]);
    });
    it('fails typed for malformed comments payloads instead of returning success-shaped output', async () => {
        const page = createPageMock({ loginWall: false, results: { rows: [] } });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed comments payload'),
        });
    });
    it('fails typed for malformed comment image payloads', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '', images: 'https://sns-img-qc.xhscdn.com/comment.jpg' },
            ],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed comment row images'),
        });
    });
    it('fails typed for non-stable comment image URLs', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '', images: ['data:image/png;base64,AAAA'] },
            ],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed comment row image URL'),
        });
    });
    it('preserves normalized valid comment image URLs in output rows', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '', images: [' https://sns-img-qc.xhscdn.com/comment.jpg '] },
            ],
        });
        const rows = await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        });
        expect(rows[0]).toMatchObject({ images: ['https://sns-img-qc.xhscdn.com/comment.jpg'] });
    });
    it('uses condition-based comment scrolling instead of a fixed blind loop', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain("const beforeCount = document.querySelectorAll('.parent-comment').length");
        expect(script).toContain("const afterCount = document.querySelectorAll('.parent-comment').length");
        expect(script).toContain('if (beforeCount >= targetCount) break');
        expect(script).toContain('if (stall >= 6) break');
    });

    it('drives scroll growth through the scroller, scrollIntoView, and window.scrollTo together', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('scroller.scrollTo(0, scroller.scrollHeight)');
        expect(script).toContain("last.scrollIntoView({ block: 'end' })");
        expect(script).toContain('window.scrollTo(0, document.body.scrollHeight)');
    });

    it('scrolls toward the requested --limit instead of stopping after one stalled round', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 50,
        });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('const targetCount = 50');
        expect(script).toContain('for (let i = 0; i < 60; i++)');
    });
    it('extracts shortform like counts from the shared xiaohongshu/rednote DOM script', async () => {
        const data = await runCommentsExtract(`
          <main>
            <section class="parent-comment">
              <div class="comment-item">
                <div class="author-wrapper"><span class="name">Alice</span></div>
                <div class="content">Great note</div>
                <span class="count">2.1w</span>
                <span class="date">today</span>
              </div>
            </section>
            <section class="parent-comment">
              <div class="comment-item">
                <span class="user-name">Bob</span>
                <div class="note-text">Malformed count</div>
                <span class="count">likes 2.1w</span>
              </div>
            </section>
          </main>
        `);

        expect(data.results).toEqual([
            { author: 'Alice', authorHrefRaw: '', text: 'Great note', likes: 21000, time: 'today', is_reply: false, reply_to: '', images: [] },
            { author: 'Bob', authorHrefRaw: '', text: 'Malformed count', likes: 0, time: '', is_reply: false, reply_to: '', images: [] },
        ]);
    });

    it('extracts attached comment photos while excluding avatars and inline emoji', async () => {
        const data = await runCommentsExtract(`
          <main>
            <section class="parent-comment">
              <div class="comment-item">
                <div class="author-wrapper">
                  <img class="avatar-item" src="https://sns-avatar-qc.xhscdn.com/avatar/abc.jpg" />
                  <span class="name">Alice</span>
                </div>
                <div class="content">Great note <img class="note-content-emoji" src="https://picasso-static.xiaohongshu.com/fe-platform/emoji.png" /></div>
                <div class="comment-pic"><img src="https://sns-img-qc.xhscdn.com/comment-photo.jpg" /></div>
                <span class="count">1</span>
                <span class="date">today</span>
              </div>
              <div class="reply-container">
                <div class="comment-item-sub">
                  <span class="name">Bob</span>
                  <div class="content">Nice</div>
                  <div class="reply-pic"><img src="https://sns-img-qc.xhscdn.com/reply-photo.jpg" /></div>
                </div>
              </div>
            </section>
          </main>
        `);

        expect(data.results[0]).toMatchObject({ author: 'Alice', text: 'Great note', images: ['https://sns-img-qc.xhscdn.com/comment-photo.jpg'] });
    });
    it('does not project author badges or action icons as comment images', async () => {
        const data = await runCommentsExtract(`
          <main>
            <section class="parent-comment">
              <div class="comment-item">
                <div class="author-wrapper">
                  <span class="name">Alice</span>
                  <img class="author-badge" src="https://sns-img-qc.xhscdn.com/badge.png" />
                </div>
                <div class="content">No attached photo</div>
                <button class="like-action"><img src="https://sns-img-qc.xhscdn.com/like-icon.png" /></button>
              </div>
            </section>
          </main>
        `);

        expect(data.results[0]).toMatchObject({ author: 'Alice', text: 'No attached photo', images: [] });
    });
    it('extracts authorHrefRaw from /user/profile/ anchor wrapping the name', async () => {
        const data = await runCommentsExtract(`
          <main>
            <section class="parent-comment">
              <div class="comment-item">
                <div class="author-wrapper"><a class="name" href="/user/profile/5e8a1b2c3d4e5f6a7b8c9d0e?xsec_token=tok">Alice</a></div>
                <div class="content">Hi</div>
                <span class="count">1</span>
                <span class="date">today</span>
              </div>
            </section>
            <section class="parent-comment">
              <div class="comment-item">
                <a class="user-name" href="https://www.xiaohongshu.com/user/profile/abc123def456">Bob</a>
                <div class="note-text">Hey</div>
              </div>
            </section>
          </main>
        `);
        expect(data.results[0].author).toBe('Alice');
        expect(data.results[0].authorHrefRaw).toBe('/user/profile/5e8a1b2c3d4e5f6a7b8c9d0e?xsec_token=tok');
        expect(data.results[1].author).toBe('Bob');
        expect(data.results[1].authorHrefRaw).toBe('https://www.xiaohongshu.com/user/profile/abc123def456');
    });
    it('respects the limit for top-level comments', async () => {
        const manyComments = Array.from({ length: 10 }, (_, i) => ({
            author: `User${i}`,
            text: `Comment ${i}`,
            likes: i,
            time: '2024-01-01',
            is_reply: false,
            reply_to: '',
        }));
        const page = createPageMock({ loginWall: false, results: manyComments });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 3,
        }));
        expect(result).toHaveLength(3);
        expect(result[0].rank).toBe(1);
        expect(result[2].rank).toBe(3);
    });
    it('enriches each row with userId and profileUrl derived from authorHrefRaw', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', authorHrefRaw: '/user/profile/abc123?xsec_token=tok', text: 'hi', likes: 1, time: 't', is_reply: false, reply_to: '' },
                { author: 'Bob', authorHrefRaw: 'https://www.xiaohongshu.com/user/profile/xyz789', text: 'hey', likes: 0, time: '', is_reply: false, reply_to: '' },
                { author: 'Anon', authorHrefRaw: '', text: 'no link', likes: 0, time: '', is_reply: false, reply_to: '' },
            ],
        });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        }));
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ rank: 1, author: 'Alice', userId: 'abc123', profileUrl: 'https://www.xiaohongshu.com/user/profile/abc123' });
        expect(result[1]).toMatchObject({ rank: 2, author: 'Bob', userId: 'xyz789', profileUrl: 'https://www.xiaohongshu.com/user/profile/xyz789' });
        expect(result[2]).toMatchObject({ rank: 3, author: 'Anon', userId: '', profileUrl: '' });
        // the raw transport field must not leak into the final row shape
        for (const row of result) {
            expect(row).not.toHaveProperty('authorHrefRaw');
            expect(row).not.toHaveProperty('authorHref');
        }
    });
    it('buildXhsProfileUrl handles trusted relative/absolute inputs and rejects host/path drift', () => {
        expect(parseXhsProfileHref('/user/profile/abc123')).toBe('abc123');
        expect(parseXhsProfileHref('https://www.xiaohongshu.com/user/profile/xyz?xsec_token=tok')).toBe('xyz');
        expect(buildXhsProfileUrl('/user/profile/abc123')).toBe('https://www.xiaohongshu.com/user/profile/abc123');
        expect(buildXhsProfileUrl('https://www.xiaohongshu.com/user/profile/xyz?xsec_token=tok')).toBe('https://www.xiaohongshu.com/user/profile/xyz');
        expect(buildXhsProfileUrl('')).toBe('');
        expect(buildXhsProfileUrl(null)).toBe('');
        expect(buildXhsProfileUrl('/user/profile/zzz', 'www.rednote.com')).toBe('https://www.rednote.com/user/profile/zzz');
        expect(buildXhsProfileUrl('http://www.xiaohongshu.com/user/profile/abc123')).toBe('');
        expect(buildXhsProfileUrl('https://evil.test/user/profile/abc123')).toBe('');
        expect(buildXhsProfileUrl('https://www.xiaohongshu.com/user/profile/abc123/extra')).toBe('');
        expect(buildXhsProfileUrl('/user/profile/abc123/extra')).toBe('');
        expect(buildXhsProfileUrl('https://www.rednote.com/user/profile/zzz', 'www.rednote.com')).toBe('https://www.rednote.com/user/profile/zzz');
        expect(buildXhsProfileUrl('https://www.xiaohongshu.com/user/profile/zzz', 'www.rednote.com')).toBe('');
    });
    it('clamps invalid negative limits to a safe minimum', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '' },
                { author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02', is_reply: false, reply_to: '' },
            ],
        });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: -3,
        }));
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ rank: 1, author: 'Alice' });
    });
    describe('--with-replies', () => {
        it('extracts the direct reply target from nested reply DOM', async () => {
            const data = await runCommentsExtract(`
              <main>
                <section class="parent-comment">
                  <div id="comment-root" class="comment-item">
                    <div class="author-wrapper"><span class="name">Alice</span></div>
                    <div class="content">Root comment</div>
                  </div>
                  <div class="reply-container">
                    <div id="comment-direct" class="comment-item-sub">
                      <div class="author-wrapper"><span class="name">Bob</span></div>
                      <div class="content"><span class="note-text">Direct reply</span></div>
                    </div>
                    <div id="comment-nested" class="comment-item-sub">
                      <div class="author-wrapper"><span class="name">Carol</span></div>
                      <div class="content">
                        <span>回复 </span><span class="nickname">Bob</span> :
                        <span class="note-text">Nested reply</span>
                      </div>
                    </div>
                  </div>
                </section>
              </main>
            `, true);

            expect(data.results).toHaveLength(3);
            expect(data.results[0]).toMatchObject({ author: 'Alice', is_reply: false, reply_to: '' });
            expect(data.results[1]).toMatchObject({ author: 'Bob', is_reply: true, reply_to: 'Alice' });
            expect(data.results[2]).toMatchObject({
                author: 'Carol',
                text: '回复 Bob : Nested reply',
                is_reply: true,
                reply_to: 'Bob',
            });
        });
        it('includes reply rows with is_reply=true and reply_to set', async () => {
            const page = createPageMock({
                loginWall: false,
                results: [
                    { author: 'Alice', text: 'Main comment', likes: 10, time: '03-25', is_reply: false, reply_to: '' },
                    { author: 'Bob', text: 'Reply to Alice', likes: 3, time: '03-25', is_reply: true, reply_to: 'Alice' },
                    { author: 'Carol', text: 'Another top', likes: 5, time: '03-26', is_reply: false, reply_to: '' },
                ],
            });
            const result = (await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok', limit: 50, 'with-replies': true,
            }));
            expect(result).toHaveLength(3);
            expect(result[0]).toMatchObject({ author: 'Alice', is_reply: false, reply_to: '' });
            expect(result[1]).toMatchObject({ author: 'Bob', is_reply: true, reply_to: 'Alice' });
            expect(result[2]).toMatchObject({ author: 'Carol', is_reply: false, reply_to: '' });
            const script = page.evaluate.mock.calls[0][0];
            expect(script).toContain('共\\d+条回复');
            expect(script).toContain('el.click()');
        });
        it('limits by top-level count, keeping attached replies', async () => {
            const page = createPageMock({
                loginWall: false,
                results: [
                    { author: 'A', text: 'Top 1', likes: 0, time: '', is_reply: false, reply_to: '' },
                    { author: 'A1', text: 'Reply 1', likes: 0, time: '', is_reply: true, reply_to: 'A' },
                    { author: 'A2', text: 'Reply 2', likes: 0, time: '', is_reply: true, reply_to: 'A' },
                    { author: 'B', text: 'Top 2', likes: 0, time: '', is_reply: false, reply_to: '' },
                    { author: 'C', text: 'Top 3', likes: 0, time: '', is_reply: false, reply_to: '' },
                ],
            });
            // Limit to 2 top-level comments — should include A + 2 replies + B = 4 rows
            const result = (await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok', limit: 2, 'with-replies': true,
            }));
            expect(result).toHaveLength(4);
            expect(result.map((r) => r.author)).toEqual(['A', 'A1', 'A2', 'B']);
        });
    });
});
