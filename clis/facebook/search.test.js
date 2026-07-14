/**
 * Facebook search: extraction against the modern /search/top DOM (#2090) plus
 * the #625 regression guard that navigation runs before DOM extraction.
 *
 * NOTE: the fixtures encode the DOM shape described in issue #2090, not a
 * captured live sample, so live verification is still required.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';

function runExtract(html, limit = 10, url = 'https://www.facebook.com/search/top?q=ai') {
  const dom = new JSDOM(html, { url });
  return Function('window', 'document', `return ${__test__.buildSearchExtractScript(limit)};`)(dom.window, dom.window.document);
}

function createPage(payload) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(payload),
  };
}

describe('facebook search', () => {
  it('registers the search command with the row contract', () => {
    const cmd = getRegistry().get('facebook/search');
    expect(cmd).toBeDefined();
    expect(cmd.columns).toEqual(['index', 'title', 'text', 'url']);
  });

  it('navigates home then to search results before extracting (#625)', async () => {
    const page = createPage({ status: 'ok', rows: [{ index: 1, title: 'X', text: 'x', url: 'https://www.facebook.com/x' }] });
    await __test__.searchFacebook(page, { query: 'AI agent', limit: 3 });
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.facebook.com');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.facebook.com/search/top?q=AI%20agent', { settleMs: 4000 });
    // extraction script must not depend on live URL reads
    expect(String(page.evaluate.mock.calls[0]?.[0] ?? '')).not.toContain('window.location.href');
  });

  it('extracts entity/content links from [role="feed"] and drops decoys (#2090)', () => {
    const payload = runExtract(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/carol.page">Carol's Page</a><span>Public figure · 12K followers</span></div>
        <div><a role="link" href="https://www.facebook.com/groups/1234567/">AI Builders Group</a><span>Group · 3K members</span></div>
        <div><a role="link" href="https://www.facebook.com/dave/posts/9988">Dave's post about AI agents</a></div>
        <a role="link" href="https://www.facebook.com/search/top?q=aaaa">See more results</a>
        <a role="link" href="https://evil-cdn.com/x">1234567890123456</a>
        <a role="link" href="https://www.facebook.com/a.b.c">a b c d e f</a>
      </div>
    `);

    expect(payload.status).toBe('ok');
    expect(payload.rows.map((r) => r.url)).toEqual([
      'https://www.facebook.com/carol.page',
      'https://www.facebook.com/groups/1234567/',
      'https://www.facebook.com/dave/posts/9988',
    ]);
    expect(payload.rows[0].title).toBe("Carol's Page");
    // decoy search link and non-facebook spam excluded
    expect(payload.rows.some((r) => /\/search\//.test(r.url))).toBe(false);
    expect(payload.rows.some((r) => /evil-cdn/.test(r.url))).toBe(false);
  });

  it('drops bare /search decoys and facebook chrome links (#2090)', () => {
    const payload = runExtract(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/realpage">Real Page</a></div>
        <a role="link" href="https://www.facebook.com/search?q=bare">Bare search decoy</a>
        <a role="link" href="https://www.facebook.com/marketplace">Marketplace</a>
        <a role="link" href="https://www.facebook.com/messages/t/123">Messages</a>
        <a role="link" href="https://www.facebook.com/notifications">Notifications</a>
      </div>
    `);
    expect(payload.rows.map((r) => r.url)).toEqual(['https://www.facebook.com/realpage']);
  });

  it('dedupes repeated entity links and honours the limit', () => {
    const payload = runExtract(`
      <div role="feed">
        <div><a role="link" href="https://www.facebook.com/carol.page">Carol's Page</a></div>
        <div><a role="link" href="https://www.facebook.com/carol.page?ref=xyz">Carol's Page (again)</a></div>
        <div><a role="link" href="https://www.facebook.com/erin">Erin</a></div>
      </div>
    `, 1);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].url).toBe('https://www.facebook.com/carol.page');
  });

  it('reports auth pages as an auth status', () => {
    const payload = runExtract('<div role="main">Log in to Facebook</div>', 10, 'https://www.facebook.com/login/');
    expect(payload.status).toBe('auth');
    expect(payload.rows).toEqual([]);
  });

  it('validates query and limit before navigation', async () => {
    const page = createPage({ status: 'ok', rows: [] });
    await expect(__test__.searchFacebook(page, { query: '  ', limit: 3 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(__test__.searchFacebook(page, { query: 'ok', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('maps auth, empty, drift, and malformed payloads to typed errors', async () => {
    await expect(__test__.searchFacebook(createPage({ status: 'auth', rows: [] }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(__test__.searchFacebook(createPage({ status: 'no_rows', rows: [], diagnostics: {} }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(EmptyResultError);
    await expect(__test__.searchFacebook(createPage({ status: 'no_rows', rows: [], diagnostics: { anchorCount: 40, mainTextLength: 800 } }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(__test__.searchFacebook(createPage({ rows: null }), { query: 'q', limit: 1 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });
});
