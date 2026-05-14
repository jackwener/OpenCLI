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
});
