import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildReadLikeStateJs, buildToggleLikeJs, setInstagramPostLike } from './post-like.js';

/**
 * Build a post page carrying an action bar control plus a comment row control
 * with the same label, so selection has to distinguish them the way the live
 * page does.
 */
function createPostDom({ actionBarLabel = 'Like', commentLabel = 'Like' } = {}) {
    const dom = new JSDOM(`
        <section id="comments">
            ${Array.from({ length: 12 }, () => '<div role="button"><svg aria-label="' + commentLabel + '" data-kind="comment"></svg></div>').join('')}
        </section>
        <section id="actions">
            <div role="button"><svg aria-label="${actionBarLabel}" data-kind="post"></svg></div>
            <div role="button"><svg aria-label="Comment"></svg></div>
            <div role="button"><svg aria-label="Share"></svg></div>
        </section>
    `, { runScripts: 'outside-only' });
    for (const icon of dom.window.document.querySelectorAll('svg')) {
        const size = icon.getAttribute('data-kind') === 'comment' ? 16 : 24;
        icon.getBoundingClientRect = () => ({ width: size, height: size });
    }
    dom.window.document.addEventListener('click', (event) => {
        const icon = event.target.querySelector?.('svg');
        if (icon) dom.window.__clicked = icon.getAttribute('data-kind');
    });
    return dom;
}

/**
 * Build a page whose evaluate answers the feed read from a canned value and
 * runs the generated page scripts against a JSDOM post page.
 */
function createPageMock({ feed, dom, onToggle } = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => {
            if (script.includes('/username/?count=')) return Promise.resolve(typeof feed === 'function' ? feed() : feed);
            if (!dom) return Promise.resolve(null);
            const result = dom.window.eval(script);
            if (script.includes('button.click()')) onToggle?.(dom);
            return Promise.resolve(result);
        }),
    };
}

const onePost = { ownerId: '42', items: [{ code: 'ABC123', pk: '98765', caption: 'a caption', liked: false }] };
const args = { username: 'someone', index: 1 };

describe('instagram post like page scripts', () => {
    it('clicks the action bar control and leaves comment controls alone', () => {
        const dom = createPostDom();

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: true, already: false });
        expect(dom.window.__clicked).toBe('post');
    });

    it('reports the post as already in the requested state from the action bar label', () => {
        const dom = createPostDom({ actionBarLabel: 'Unlike', commentLabel: 'Like' });

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: true, already: true });
        expect(dom.window.__clicked).toBeUndefined();
    });

    it('reads the like state from the action bar and not from a comment row', () => {
        const liked = createPostDom({ actionBarLabel: 'Unlike', commentLabel: 'Like' });
        const notLiked = createPostDom({ actionBarLabel: 'Like', commentLabel: 'Unlike' });

        expect(liked.window.eval(buildReadLikeStateJs(true))).toBe(true);
        expect(notLiked.window.eval(buildReadLikeStateJs(true))).toBe(false);
        expect(notLiked.window.eval(buildReadLikeStateJs(false))).toBe(true);
    });

    it('accepts the Chinese labels the interface uses when it is not in English', () => {
        const dom = createPostDom({ actionBarLabel: '赞', commentLabel: '赞' });

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: true, already: false });
        expect(dom.window.__clicked).toBe('post');
    });

    it('finds no control when the labeled icon is 16px even in a sparse container', () => {
        const dom = new JSDOM('<div role="group"><div role="button"><svg aria-label="Like"></svg></div></div>', { runScripts: 'outside-only' });
        dom.window.document.querySelector('svg').getBoundingClientRect = () => ({ width: 16, height: 16 });

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: false });
    });

    it('finds no control when a full-size like icon lacks action-bar siblings', () => {
        const dom = new JSDOM('<section><div role="button"><svg aria-label="Like"></svg></div></section>', { runScripts: 'outside-only' });
        dom.window.document.querySelector('svg').getBoundingClientRect = () => ({ width: 24, height: 24 });

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: false });
    });

    it('finds no control when the full-size icon sits among many labeled comment icons', () => {
        const dom = new JSDOM(`
            <section>
                ${Array.from({ length: 12 }, () => '<div role="button"><svg aria-label="Like"></svg></div>').join('')}
            </section>
        `, { runScripts: 'outside-only' });
        for (const icon of dom.window.document.querySelectorAll('svg')) {
            icon.getBoundingClientRect = () => ({ width: 24, height: 24 });
        }

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: false });
    });

    it('finds no control when the action bar has not rendered', () => {
        const dom = new JSDOM('<section id="comments"></section>', { runScripts: 'outside-only' });

        expect(dom.window.eval(buildToggleLikeJs(true))).toEqual({ found: false });
    });
});

describe('instagram post like', () => {
    it('reports success only after the flipped icon holds', async () => {
        const dom = createPostDom();
        let feed = onePost;
        const page = createPageMock({
            feed: () => feed,
            dom,
            onToggle: (d) => {
                d.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Unlike');
                feed = { ownerId: '42', items: [{ code: 'ABC123', pk: '98765', caption: 'a caption', liked: true }] };
            },
        });

        await expect(setInstagramPostLike(page, args, true)).resolves.toEqual([
            { status: 'Liked', user: 'someone', post: 'a caption' },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.instagram.com/p/ABC123/', { settleMs: 2000 });
        expect(page.evaluate.mock.calls.filter(([script]) => script.includes('/username/?count='))).toHaveLength(2);
    });

    it('typed-fails when the icon flips and then reverts', async () => {
        const dom = createPostDom();
        let reads = 0;
        const page = createPageMock({
            feed: onePost,
            dom,
            onToggle: (d) => d.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Unlike'),
        });
        const inner = page.evaluate;
        page.evaluate = vi.fn((script) => {
            if (script.includes('return liked ===') && ++reads === 2) {
                dom.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Like');
            }
            return inner(script);
        });

        await expect(setInstagramPostLike(page, args, true)).rejects.toThrow('Instagram did not keep the like on ABC123');
    });

    it('typed-fails after retrying a post page that never renders the control', async () => {
        const page = createPageMock({ feed: onePost, dom: new JSDOM('<main></main>', { runScripts: 'outside-only' }) });

        await expect(setInstagramPostLike(page, args, true)).rejects.toThrow('Could not find the like control on ABC123');
        expect(page.evaluate.mock.calls.filter(([script]) => script.includes('button.click()'))).toHaveLength(5);
    });

    it('typed-fails when the DOM flips but the feed does not persist the state', async () => {
        const dom = createPostDom();
        const page = createPageMock({
            feed: onePost,
            dom,
            onToggle: (d) => d.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Unlike'),
        });

        await expect(setInstagramPostLike(page, args, true)).rejects.toThrow('Instagram did not persist the like on ABC123');
    });

    it('typed-fails when the feed changes to a different post after click', async () => {
        const dom = createPostDom();
        const page = createPageMock({
            feed: onePost,
            dom,
            onToggle: (d) => d.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Unlike'),
        });
        let reads = 0;
        const inner = page.evaluate;
        page.evaluate = vi.fn((script) => {
            if (script.includes('/username/?count=') && ++reads === 2) {
                return Promise.resolve({ ownerId: '42', items: [{ code: 'DIFFERENT', pk: '12345', caption: 'other', liked: true }] });
            }
            return inner(script);
        });

        await expect(setInstagramPostLike(page, args, true)).rejects.toThrow('Instagram post feed no longer shows the expected post ABC123 at index 1');
    });

    it('skips the post page when the feed already shows the target state', async () => {
        const page = createPageMock({ feed: { ownerId: '42', items: [{ code: 'ABC123', pk: '98765', caption: 'a caption', liked: true }] } });

        await expect(setInstagramPostLike(page, args, true)).resolves.toEqual([
            { status: 'Already liked', user: 'someone', post: 'a caption' },
        ]);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('requires feed confirmation when the post page already shows the target state', async () => {
        const dom = createPostDom({ actionBarLabel: 'Unlike', commentLabel: 'Like' });
        let reads = 0;
        const page = createPageMock({
            feed: () => {
                reads += 1;
                return reads === 1
                    ? onePost
                    : { ownerId: '42', items: [{ code: 'ABC123', pk: '98765', caption: 'a caption', liked: true }] };
            },
            dom,
        });

        await expect(setInstagramPostLike(page, args, true)).resolves.toEqual([
            { status: 'Already liked', user: 'someone', post: 'a caption' },
        ]);
        expect(page.evaluate.mock.calls.filter(([script]) => script.includes('/username/?count='))).toHaveLength(2);
    });

    it('typed-fails when an already-state DOM control is not confirmed by the feed', async () => {
        const dom = createPostDom({ actionBarLabel: 'Unlike', commentLabel: 'Like' });
        const page = createPageMock({ feed: onePost, dom });

        await expect(setInstagramPostLike(page, args, true)).rejects.toThrow('Instagram did not persist the like on ABC123');
    });

    it('unlikes through the same control and reports the reverse status', async () => {
        const dom = createPostDom({ actionBarLabel: 'Unlike', commentLabel: 'Unlike' });
        let feed = { ownerId: '42', items: [{ code: 'ABC123', pk: '98765', caption: 'a caption', liked: true }] };
        const page = createPageMock({
            feed: () => feed,
            dom,
            onToggle: (d) => {
                d.window.document.querySelector('svg[data-kind="post"]').setAttribute('aria-label', 'Like');
                feed = onePost;
            },
        });

        await expect(setInstagramPostLike(page, args, false)).resolves.toEqual([
            { status: 'Unliked', user: 'someone', post: 'a caption' },
        ]);
    });

    it('names the running command in empty results', async () => {
        await expect(setInstagramPostLike(createPageMock({ feed: { ownerId: '42', items: [] } }), { username: 'ghost', index: 1 }, true))
            .rejects.toMatchObject({ message: 'instagram like returned no data', hint: expect.stringContaining('No visible posts for ghost') });

        await expect(setInstagramPostLike(createPageMock({ feed: { ownerId: '42', items: [] } }), { username: 'ghost', index: 1 }, false))
            .rejects.toMatchObject({ message: 'instagram unlike returned no data' });

        await expect(setInstagramPostLike(createPageMock({ feed: onePost }), { username: 'someone', index: 4 }, true))
            .rejects.toMatchObject({ hint: expect.stringContaining('Post index 4 not found; someone has 1 recent posts.') });
    });

    it('rejects a non-positive index before touching the page', async () => {
        const page = createPageMock({ feed: onePost });

        await expect(setInstagramPostLike(page, { username: 'someone', index: 0 }, true))
            .rejects.toThrow('--index must be a positive integer');
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects an empty username before touching the page', async () => {
        const page = createPageMock({ feed: onePost });

        await expect(setInstagramPostLike(page, { username: '', index: 1 }, true))
            .rejects.toThrow('username is required');
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('separates a missing account from a transport failure', async () => {
        await expect(setInstagramPostLike(createPageMock({ feed: { error: 404 } }), { username: 'ghost', index: 1 }, true))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: expect.stringContaining('No Instagram user named ghost') });

        await expect(setInstagramPostLike(createPageMock({ feed: { error: 429 } }), args, true))
            .rejects.toThrow('Instagram returned HTTP 429');

        await expect(setInstagramPostLike(createPageMock({ feed: { error: 401 } }), args, true))
            .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it('typed-fails malformed feed payloads and rows', async () => {
        await expect(setInstagramPostLike(createPageMock({ feed: { items: [] } }), args, true))
            .rejects.toThrow('Instagram post feed returned no valid owner id for someone');

        await expect(setInstagramPostLike(createPageMock({ feed: { ownerId: '42', items: null } }), args, true))
            .rejects.toThrow('Instagram post feed returned malformed items for someone');

        await expect(setInstagramPostLike(createPageMock({ feed: { ownerId: '42', items: [{ code: 'ABC123', pk: { bad: true }, liked: false }] } }), args, true))
            .rejects.toThrow('Instagram post feed returned malformed post row for someone');

        await expect(setInstagramPostLike(createPageMock({ feed: { ownerId: '42', items: [{ code: 'ABC123', pk: '98765' }] } }), args, true))
            .rejects.toThrow('Instagram post feed returned malformed post row for someone');
    });
});
