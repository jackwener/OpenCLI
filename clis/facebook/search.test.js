import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { facebookSearchCommand, __test__ } from './search.js';

function runBrowserScript(html, script, url = 'https://www.facebook.com/search/top?q=test') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

const FIXTURE = `
  <a href="https://www.facebook.com/leftnav">Home</a>
  <div role="feed">
    <div role="article">
      <a href="https://www.facebook.com/john.doe">John Doe</a>
      <div>John Doe · 1.2k followers</div>
    </div>
    <a href="https://www.facebook.com/somepage/">Some Page</a>
    <a href="https://www.facebook.com/search/top?q=x">search decoy</a>
    <a href="https://www.facebook.com/1234567890123456">1234567890123456</a>
    <a href="https://www.facebook.com/zz">a b c d e</a>
    <a href="https://example.com/notfb">External Site</a>
    <a href="https://notfacebook.com/evil">Not Facebook</a>
    <a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fspam.com">Redirect</a>
  </div>`;

describe('facebook search extraction (#2090)', () => {
    it('keeps real feed entity links and drops nav / decoys / obfuscation', async () => {
        const rows = await runBrowserScript(FIXTURE, __test__.buildFacebookSearchJs(10));
        expect(rows.map(r => r.url)).toEqual([
            'https://www.facebook.com/john.doe', // real person entity
            'https://www.facebook.com/somepage/', // real page entity
        ]);
        // Dropped: /search/ decoy, 16-digit token, "a b c d e" single-char decoy,
        // external link, and the out-of-feed nav link.
        expect(rows.map(r => r.index)).toEqual([1, 2]);
        expect(rows[0].title).toBe('John Doe');
    });

    it('respects the limit', async () => {
        const rows = await runBrowserScript(FIXTURE, __test__.buildFacebookSearchJs(1));
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toBe('https://www.facebook.com/john.doe');
    });

    it('returns [] when there is no role=feed container', async () => {
        const rows = await runBrowserScript('<div><a href="https://www.facebook.com/x">x</a></div>', __test__.buildFacebookSearchJs(10));
        expect(rows).toEqual([]);
    });

    it('preserves query-identity params for content URLs (photo.php / watch)', async () => {
        const html = `<div role="feed">
          <a href="https://www.facebook.com/photo.php?fbid=999&__tn__=trk">Cool Photo</a>
          <a href="https://www.facebook.com/watch/?v=12345">A Video</a>
        </div>`;
        const rows = await runBrowserScript(html, __test__.buildFacebookSearchJs(10));
        expect(rows.map(r => r.url)).toEqual([
            'https://www.facebook.com/photo.php?fbid=999&__tn__=trk',
            'https://www.facebook.com/watch/?v=12345',
        ]);
    });

    it('uses the anchor text (not the whole feed) for a bare feed-level link', async () => {
        const html = `<div role="feed">
          <a href="https://www.facebook.com/alice">Alice Wonderland</a>
          <a href="https://www.facebook.com/bob">Bob Builder</a>
        </div>`;
        const rows = await runBrowserScript(html, __test__.buildFacebookSearchJs(10));
        expect(rows[0].text).toBe('Alice Wonderland');
    });
});

describe('facebook search command (func)', () => {
    function makePage(evalResult) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(evalResult),
        };
    }

    it('navigates to /search/top before extracting the DOM (regression #625)', async () => {
        const rows = [{ index: 1, title: 'x', text: 'y', url: 'https://www.facebook.com/x' }];
        const page = makePage(rows);
        const out = await facebookSearchCommand.func(page, { query: 'AI agent', limit: 3 });
        expect(out).toBe(rows);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.facebook.com');
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.facebook.com/search/top?q=AI%20agent', { settleMs: 4000 });
        // #625: extraction must run only after navigation completed.
        expect(page.evaluate.mock.invocationCallOrder[0]).toBeGreaterThan(page.goto.mock.invocationCallOrder[1]);
    });

    it('unwraps the Browser Bridge {session,data} envelope', async () => {
        const rows = [{ index: 1, title: 'x', text: 'y', url: 'u' }];
        const out = await facebookSearchCommand.func(makePage({ session: 'site:facebook', data: rows }), { query: 'x' });
        expect(out).toBe(rows);
    });

    it('throws CommandExecutionError on a non-array payload', async () => {
        await expect(facebookSearchCommand.func(makePage({ oops: true }), { query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
