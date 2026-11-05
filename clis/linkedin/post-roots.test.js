import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildPostsScript, collectPosts } from './posts-core.js';
import { locatePostCards } from './post-roots.js';
const doms = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });
const post = (id, body = `Distinct post body ${id}`) => `<a href="/in/author-${id}/">Author ${id}</a>\n<a href="/feed/update/urn:li:activity:${id}/?tracking=1">2h</a>\n<p dir="ltr">${body}</p>\n<div>12 reactions</div>\n<div>3 comments</div>`;
function fixture(html) {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://www.linkedin.com/in/test/recent-activity/all/', runScripts: 'outside-only' });
  doms.push(dom); return dom;
}
describe('LinkedIn permalink card roots', () => {
  it('extracts separate list items without legacy card classes', () => {
    const dom = fixture(`<ul><li>${post('111')}</li><li>${post('222')}</li></ul>`);
    const payload = dom.window.eval(buildPostsScript());
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows.map(row => row.author)).toEqual(['Author 111', 'Author 222']);
    expect(payload.rows.map(row => row.body)).toEqual(['Distinct post body 111', 'Distinct post body 222']);
    expect(payload.rows[0]).toMatchObject({ comments: 3, reactions: 12 });
    expect(payload.unmatchedPermalinks).toBe(0);
  });
  it('finds a generic single-post container and deduplicates alternate tracking links', () => {
    const dom = fixture(`<section><div>${post('111')}<a href="/posts/author_activity-111-abcd/?tracking=2">Post link</a></div><div>${post('222')}</div></section>`);
    const found = locatePostCards(dom.window.document);
    expect(found.cards).toHaveLength(2); expect(found.unmatchedPermalinks).toBe(0);
  });
  it('does not merge separate permalinks in a shared container', () => {
    const dom = fixture(`<div>${post('111')}${post('222')}</div>`);
    const found = locatePostCards(dom.window.document);
    expect(found.cards).toHaveLength(0); expect(found.unmatchedPermalinks).toBe(2);
  });
  it('does not treat a bare permalink or navigation link as a post card', () => {
    const dom = fixture('<nav><a href="/posts/navigation">Navigation</a></nav><div><a href="/posts/unstructured">Post</a></div>');
    const found = locatePostCards(dom.window.document);
    expect(found.cards).toHaveLength(0); expect(found.unmatchedPermalinks).toBe(1);
  });
  it('ignores hidden clones and external lookalike links', () => {
    const dom = fixture(`<ul><li hidden>${post('111')}</li><li>${post('222')}</li></ul><a href="https://evil.invalid/posts/x">External</a>`);
    const found = locatePostCards(dom.window.document);
    expect(found.cards).toHaveLength(1); expect(found.unmatchedPermalinks).toBe(0);
    expect(found.cards[0].textContent).toContain('Author 222');
  });
  it('keeps complete legacy cards once, including short posts', () => {
    const dom = fixture('<article><div class="feed-shared-update-v2"><p class="update-components-text">A short post</p><a href="/posts/short">link</a></div><div>9 comments</div></article>');
    const payload = dom.window.eval(buildPostsScript());
    expect(payload.rows).toHaveLength(1); expect(payload.rows[0]).toMatchObject({ body: 'A short post', comments: 9 });
  });
});
describe('LinkedIn posts collection outcomes', () => {
  function pageFor(payload) {
    return { goto: vi.fn(), wait: vi.fn(), autoScroll: vi.fn(), evaluate: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(payload) };
  }
  it('reports layout drift when permalinks cannot be associated with cards', async () => {
    await expect(collectPosts(pageFor({ rows: [], unmatchedPermalinks: 2 }), { limit: 2 })).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('layout') });
  });
  it('preserves genuine empty result behavior', async () => {
    await expect(collectPosts(pageFor({ rows: [], unmatchedPermalinks: 0 }), { limit: 2 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
  });
  it('waits for later hydrated cards after an initially unmatched permalink', async () => {
    const page = pageFor({ rows: [{ body: 'Loaded body', url: 'https://www.linkedin.com/posts/a' }], unmatchedPermalinks: 0 });
    page.evaluate.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce({ rows: [], unmatchedPermalinks: 1 }).mockResolvedValue({ rows: [{ body: 'Loaded body', url: 'https://www.linkedin.com/posts/a' }], unmatchedPermalinks: 0 });
    expect(await collectPosts(page, { limit: 1 })).toHaveLength(1); expect(page.autoScroll).toHaveBeenCalledTimes(1);
  });
});
// Reconstructed from the #2651 report and its local repair (PR #2652), not a
// captured live page: SDUi activity cards keyed by FeedType, body in
// expandable-text-box, counts on labelled action buttons, no permalinks.
const sduiCard = (id, key = `FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW-${id}`) => `<div id="${key}">
  <a href="/in/author-${id}/">Author ${id}</a><span>3d</span>
  <div data-testid="expandable-text-box">SDUi post body ${id} with enough text</div>
  <button aria-label="Reactions: view who reacted">4${id.slice(-1)}</button>
  <button aria-label="Comment on this post">7 comments</button>
  <button aria-label="Repost">2</button>
</div>`;
describe('LinkedIn SDUi activity cards (#2651)', () => {
  it('extracts SDUi cards that have no legacy classes or permalinks', () => {
    const dom = fixture(`<div id="list-FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW">${sduiCard('111')}${sduiCard('222')}</div>`);
    const payload = dom.window.eval(buildPostsScript());
    expect(payload.rows.map(row => row.body)).toEqual(['SDUi post body 111 with enough text', 'SDUi post body 222 with enough text']);
    expect(payload.rows.map(row => row.author)).toEqual(['Author 111', 'Author 222']);
    expect(payload.rows[0]).toMatchObject({ reactions: 41, comments: 7, reposts: 2, url: '' });
  });
  it('derives the permalink only from a URN present on the card', () => {
    const dom = fixture(sduiCard('333', 'urn:li:activity:7390000000000000333FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW'));
    const payload = dom.window.eval(buildPostsScript());
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7390000000000000333/');
  });
  it('keeps a card with a nested FeedType component as one post', () => {
    const dom = fixture(`<div componentkey="FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW-444">${sduiCard('444', 'inner-FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW-444')}</div>${sduiCard('555')}`);
    const found = locatePostCards(dom.window.document);
    expect(found.cards).toHaveLength(2);
    expect(found.cards[0].getAttribute('componentkey')).toBe('FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW-444');
  });
  it('still prefers legacy permalink cards when SDUi markup is absent', () => {
    const dom = fixture(`<ul><li>${post('111')}</li></ul>`);
    const payload = dom.window.eval(buildPostsScript());
    expect(payload.rows[0]).toMatchObject({ url: 'https://www.linkedin.com/feed/update/urn:li:activity:111/?tracking=1', reactions: 12, comments: 3 });
  });
});
