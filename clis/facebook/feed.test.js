import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './feed.js';

function runExtract(html, limit = 10, url = 'https://www.facebook.com/') {
  const dom = new JSDOM(html, { url });
  return Function('window', 'document', `return ${__test__.buildFeedExtractScript(limit)};`)(dom.window, dom.window.document);
}

function createPage(payload) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(payload),
  };
}

describe('facebook feed', () => {
  it('registers the feed command with the existing row contract', () => {
    const cmd = getRegistry().get('facebook/feed');
    expect(cmd).toBeDefined();
    expect(cmd.columns).toEqual(['index', 'author', 'content', 'likes', 'comments', 'shares']);
  });

  it('extracts existing role=article feed rows', () => {
    const payload = runExtract(`
      <main role="main">
        <div role="article">
          <h2><a href="https://www.facebook.com/alice">Alice Example</a></h2>
          <div dir="auto">This is a normal Facebook feed post with enough text to extract.</div>
          <span>All: 12</span>
          <span>3 comments</span>
          <span>2 shares</span>
          <div aria-label="Like"></div><div aria-label="Comment"></div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows).toEqual([{
      index: 1,
      author: 'Alice Example',
      content: 'This is a normal Facebook feed post with enough text to extract.',
      likes: '12',
      comments: '3',
      shares: '2',
    }]);
  });

  it('falls back from empty article nodes to action-bounded feed containers', () => {
    const payload = runExtract(`
      <main role="main">
        <div role="article"></div>
        <section>
          <div>
            <h2><a href="https://www.facebook.com/bob/posts/123">Bob Builder</a></h2>
            <div dir="auto">Fallback post body from a Facebook feed card with empty article text.</div>
            <a href="https://www.facebook.com/bob/posts/123">Permalink</a>
            <span>All: 1.2K</span>
            <span>4 comments</span>
            <span>1 shares</span>
            <div><button aria-label="Like">Like</button><button aria-label="Comment">Comment</button></div>
          </div>
        </section>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows).toEqual([{
      index: 1,
      author: 'Bob Builder',
      content: 'Fallback post body from a Facebook feed card with empty article text.',
      likes: '1.2K',
      comments: '4',
      shares: '1',
    }]);
  });

  it('does not turn suggestions or side chrome action buttons into feed rows', () => {
    const payload = runExtract(`
      <main role="main">
        <aside>
          <h2>People you may know</h2>
          <div dir="auto">Charlie Suggested</div>
          <div dir="auto">Add friend from suggested people card with plenty of text.</div>
          <button aria-label="Like">Like</button>
          <button aria-label="Comment">Comment</button>
        </aside>
        <nav>
          <div dir="auto">Navigation item with a Like button but not a feed post.</div>
          <button aria-label="Like">Like</button>
          <button aria-label="Comment">Comment</button>
        </nav>
      </main>
    `);

    expect(payload.status).toBe('no_rows');
    expect(payload.rows).toEqual([]);
  });

  it('still considers bounded fallback rows when article nodes are suggestion chrome', () => {
    const payload = runExtract(`
      <main role="main">
        <div role="article">
          <h2>People you may know</h2>
          <div dir="auto">Suggested profile card with enough text to look article-like.</div>
          <button aria-label="Like">Like</button>
          <button aria-label="Comment">Comment</button>
        </div>
        <section>
          <div>
            <h2><a href="https://www.facebook.com/dana/posts/456">Dana Poster</a></h2>
            <div dir="auto">Fallback feed post should still be extracted after suggestion articles are filtered.</div>
            <a href="https://www.facebook.com/dana/posts/456">Permalink</a>
            <button aria-label="Like">Like</button>
            <button aria-label="Comment">Comment</button>
          </div>
        </section>
      </main>
    `, 1);

    expect(payload.status).toBe('ok');
    expect(payload.rows).toEqual([{
      index: 1,
      author: 'Dana Poster',
      content: 'Fallback feed post should still be extracted after suggestion articles are filtered.',
      likes: '-',
      comments: '-',
      shares: '-',
    }]);
  });

  it('reports auth pages from the browser extractor', () => {
    const payload = runExtract('<main role="main">Log in to Facebook</main>', 10, 'https://www.facebook.com/login/');
    expect(payload.status).toBe('auth');
    expect(payload.rows).toEqual([]);
  });

  it('validates limit before browser navigation', async () => {
    const page = createPage({ status: 'ok', rows: [] });
    await expect(__test__.command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('maps browser envelopes and returns extracted rows', async () => {
    const page = createPage({ session: 'site:facebook', data: { status: 'ok', rows: [{ index: 1, author: 'A', content: 'Body', likes: '-', comments: '-', shares: '-' }] } });

    await expect(__test__.command.func(page, { limit: 1 })).resolves.toEqual([{
      index: 1,
      author: 'A',
      content: 'Body',
      likes: '-',
      comments: '-',
      shares: '-',
    }]);
  });

  it('keeps scrolling when raw article markers reach the limit but valid rows do not (#2195)', async () => {
    const page = {
      evaluate: vi.fn()
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce({ status: 'no_rows', rows: [] })
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce({
          status: 'ok',
          rows: [{ index: 1, author: 'A', content: 'Body', likes: '-', comments: '-', shares: '-' }],
        }),
    };

    await __test__.loadFeedPosts(page, 1);

    expect(page.evaluate).toHaveBeenCalledTimes(4);
    expect(String(page.evaluate.mock.calls[1][0])).toContain('primaryContainers');
  });

  it('maps auth, real empty, parser drift, and malformed payloads to typed errors', async () => {
    await expect(__test__.command.func(createPage({ status: 'auth', rows: [] }), { limit: 1 }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(__test__.command.func(createPage({ status: 'empty', rows: [] }), { limit: 1 }))
      .rejects.toBeInstanceOf(EmptyResultError);
    await expect(__test__.command.func(createPage({ status: 'no_rows', rows: [], diagnostics: { articleCount: 1, fallbackActionCount: 2, mainTextLength: 500 } }), { limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(__test__.command.func(createPage({ rows: null }), { limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  // Modern Facebook feed (#2089): no [role="article"], no Like/Comment
  // aria-labels — each post is bounded by its "Actions for this post" menu.
  // NOTE: this fixture encodes the DOM shape described in the issue, not a
  // captured live sample, so live verification is still required.
  it('extracts modern feed posts anchored on the "Actions for this post" menu (#2089)', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/carol">Carol Poster</a></h3>
            <div dir="auto">A modern feed post with no role=article wrapper anywhere on it.</div>
            <a href="https://www.facebook.com/carol/posts/999">2h</a>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/dave">Dave Danger</a></h3>
            <div dir="auto">Second streamed post body that should also be extracted fine.</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.diagnostics.actionMenuCount).toBe(2);
    expect(payload.rows.map((r) => r.author)).toEqual(['Carol Poster', 'Dave Danger']);
    expect(payload.rows[0].content).toContain('modern feed post');
  });

  it('keeps a legitimate author name that contains a 4-digit run (#2089)', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/class2024">Class of 2024</a></h3>
            <div dir="auto">Reunion planning post body long enough to be extracted correctly.</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/other">Someone Else</a></h3>
            <div dir="auto">A second post so the container walk stops before the main landmark.</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);
    expect(payload.rows[0].author).toBe('Class of 2024');
  });

  it('does not emit the whole main landmark as one post on a single-post page (#2089)', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/solo">Solo Poster</a></h3>
            <div dir="auto">The only post on the page — the container must not climb to role=main.</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].author).toBe('Solo Poster');
  });

  it('rejects a digit-bearing decoy author and hidden-char decoy text (#2089)', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/real">Real Human</a></h3>
            <span>​​​</span>
            <div dir="auto">Genuine post content that survives the anti-scrape decoy filtering.</div>
            <div dir="auto">1234567890123</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].author).toBe('Real Human');
    expect(payload.rows[0].content).not.toContain('1234567890123');
  });

  it('extracts authors from the group-scoped user links used by current Facebook', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/groups/123/user/456/">Group Author</a></h3>
            <div dir="auto">A genuine freelance group post with enough useful text to extract.</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows[0].author).toBe('Group Author');
  });

  it('removes combining-grapheme anti-scrape characters from decoy blocks', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div>
            <h3><a role="link" href="https://www.facebook.com/real-author">Real Author</a></h3>
            <div dir="auto">Genuine post content that remains after current Facebook decoys are removed.</div>
            <div dir="auto">a͏ b͏ c͏ d͏ e͏ f͏</div>
            <div aria-label="Actions for this post" role="button"></div>
          </div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows[0].content).toBe('Genuine post content that remains after current Facebook decoys are removed.');
  });

  it('does not let a misleading post menu in people suggestions consume surrounding page chrome', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div dir="auto">Facebook navigation label with enough characters to look like content.</div>
          <section>
            <h2 dir="auto">People you may know</h2>
            <div>
              <div dir="auto">Suggested Person</div>
              <div dir="auto">12 mutual friends</div>
              <button aria-label="Actions for this post"></button>
            </div>
          </section>
          <div dir="auto">Unrelated page text that must never become a feed row.</div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('no_rows');
    expect(payload.rows).toEqual([]);
  });

  it('extracts current post action labels that include the author name', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div dir="auto">Current Facebook post body with enough meaningful text to extract.</div>
          <button aria-label="Actions for this post by Current Author"></button>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows[0].author).toBe('Current Author');
    expect(payload.rows[0].content).toContain('Current Facebook post body');
  });

  it('does not treat current role=article comment nodes as feed posts', () => {
    const payload = runExtract(`
      <main role="main">
        <div role="article">
          <a role="link" href="https://www.facebook.com/commenter?comment_id=abc">Comment Author</a>
          <div dir="auto">A long reply that is a comment, not a top-level Facebook feed post.</div>
          <a href="https://www.facebook.com/author/posts/123?comment_id=abc">12h</a>
          <button aria-label="Like"></button>
        </div>
      </main>
    `);

    expect(payload.status).toBe('no_rows');
    expect(payload.rows).toEqual([]);
  });

  it('keeps walking past a permalink header to include its sibling post body', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <header>
            <h3><a role="link" href="https://www.facebook.com/alice">Alice Poster</a></h3>
            <a href="https://www.facebook.com/alice/posts/123">2h</a>
            <button aria-label="Actions for this post by Alice Poster"></button>
          </header>
          <div dir="auto">The actual post body is a sibling of the header containing the action menu.</div>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows[0].author).toBe('Alice Poster');
    expect(payload.rows[0].content).toBe('The actual post body is a sibling of the header containing the action menu.');
  });

  it('does not emit an authorless suggestion card with long descriptive text', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <div dir="auto">Suggested profile description long enough to resemble genuine post content.</div>
          <button aria-label="Actions for this post"></button>
        </div>
      </main>
    `);

    expect(payload.status).toBe('no_rows');
    expect(payload.rows).toEqual([]);
  });

  it('removes injected random-domain and opaque-token decoy blocks', () => {
    const payload = runExtract(`
      <main role="main">
        <div>
          <h3><a role="link" href="https://www.facebook.com/real-author">Real Author</a></h3>
          <div dir="auto">Genuine post body that should remain readable after decoy filtering.</div>
          <div dir="auto">wA4xvbU.com</div>
          <div dir="auto">8Mt4DKRlTLDjXTjnl4iAP5YS4DzIxQF52c7togr51dUFTo</div>
          <div dir="auto">onspeodSrtt5A12f71: 501aut12gi250s 8liui54P1u0cf 352Mf2617t · Shared with Public</div>
          <button aria-label="Actions for this post by Real Author"></button>
        </div>
      </main>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows[0].content).toBe('Genuine post body that should remain readable after decoy filtering.');
  });
});
