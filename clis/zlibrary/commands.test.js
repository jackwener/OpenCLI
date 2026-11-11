import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';

import { runSearch } from './search.js';
import {
  readMirror,
  buildSearchUrls,
  buildSearchExtractScript,
  getMirrors,
  isZlibraryHost,
  normalizeZlibraryBookUrl,
} from './utils.js';

function runExtract(html, limit = 10, url = 'https://z-lib.id/s/?q=test') {
  const dom = new JSDOM(html, { url });
  const script = buildSearchExtractScript(limit);
  return JSON.parse(Function('window', 'document', `return (${script});`)(dom.window, dom.window.document));
}

describe('zlibrary commands', () => {

  it('normalizes search query and rejects empty searches', () => {
    expect(buildSearchUrls('  test book  ', 'z-lib.id')[0]).toBe('https://z-lib.id/s?q=test%20book');
    expect(() => buildSearchUrls('   ', 'z-lib.id')).toThrow(ArgumentError);
    expect(() => buildSearchUrls('test', ' ')).toThrow(ArgumentError);
  });

  it('offers both search URL shapes so either UI can answer', () => {
    expect(buildSearchUrls('test book', 'z-lib.id')).toEqual([
      'https://z-lib.id/s?q=test%20book',
      'https://z-lib.id/s/test%20book',
    ]);
    expect(buildSearchUrls('test', 'http://127.0.0.1:8086')).toEqual([
      'http://127.0.0.1:8086/s?q=test',
      'http://127.0.0.1:8086/s/test',
    ]);
  });

  it('rejects an env mirror override that lists no mirrors', () => {
    const previous = process.env.OPENCLI_ZLIBRARY_MIRROR;
    try {
      process.env.OPENCLI_ZLIBRARY_MIRROR = ',';
      expect(() => getMirrors()).toThrow(ArgumentError);
      process.env.OPENCLI_ZLIBRARY_MIRROR = '  ';
      expect(getMirrors()[0]).toBe('z-lib.id');
    } finally {
      if (previous === undefined) delete process.env.OPENCLI_ZLIBRARY_MIRROR;
      else process.env.OPENCLI_ZLIBRARY_MIRROR = previous;
    }
  });

  it('defaults to the first mirror but honours the env override', () => {
    const previous = process.env.OPENCLI_ZLIBRARY_MIRROR;
    try {
      delete process.env.OPENCLI_ZLIBRARY_MIRROR;
      expect(getMirrors()[0]).toBe('z-lib.id');
      process.env.OPENCLI_ZLIBRARY_MIRROR = 'https://z-library.sk, z-lib.id';
      expect(getMirrors()).toEqual(['https://z-library.sk', 'z-lib.id']);
    } finally {
      if (previous === undefined) delete process.env.OPENCLI_ZLIBRARY_MIRROR;
      else process.env.OPENCLI_ZLIBRARY_MIRROR = previous;
    }
  });

  it('accepts book URLs on any Z-Library mirror and rejects other hosts', () => {
    expect(isZlibraryHost('z-lib.id')).toBe(true);
    expect(isZlibraryHost('www.z-library.sk')).toBe(true);
    expect(isZlibraryHost('example.com')).toBe(false);
    // A prefix match would accept these; the host check must not.
    expect(isZlibraryHost('z-lib.id.evil.com')).toBe(false);
    expect(isZlibraryHost('z-library.attacker.tld')).toBe(false);
    expect(isZlibraryHost('1lib.evil.io')).toBe(false);
    expect(isZlibraryHost('z-lib.gs')).toBe(true);
    // Live mirrors on TLDs that did not exist when the adapter was written.
    expect(isZlibraryHost('z-lib.ai')).toBe(true);
    expect(isZlibraryHost('z-lib.fm')).toBe(true);
    // A trailing dot is DNS-equivalent to the bare host.
    expect(isZlibraryHost('z-lib.id.')).toBe(true);

    expect(normalizeZlibraryBookUrl('https://z-lib.id/book/demo')).toBe('https://z-lib.id/book/demo');
    expect(normalizeZlibraryBookUrl('https://www.z-library.sk/book/demo')).toBe('https://www.z-library.sk/book/demo');
    expect(() => normalizeZlibraryBookUrl('https://example.com/book/demo')).toThrow(ArgumentError);
    // Credentials never leak into the url column.
    expect(normalizeZlibraryBookUrl('https://user:pw@z-lib.id/book/demo')).toBe('https://z-lib.id/book/demo');
    expect(() => normalizeZlibraryBookUrl('not a url')).toThrow(ArgumentError);
  });

  it('extracts the legacy resItemBox result list', () => {
    const rows = runExtract(`
      <div class="resItemBox resItemBoxBooks">
        <table><tr class="bookRow">
          <td>
            <h3 itemprop="name"><a href="/book/tales-of-the-black-widowers">Tales of the Black Widowers</a></h3>
            <div class="authors">
              <a class="color1" href="/author/Asimov">Asimov</a>,
              <a class="color1" href="/author/Isaac">Isaac</a>
            </div>
            <div class="bookProperty"><span>Year:</span> <span>1974</span></div>
            <div class="bookProperty"><span>Language:</span> <span>English</span></div>
            <div class="bookProperty"><span>File:</span> <span>EPUB, 181.93 KB</span></div>
          </td>
        </tr></table>
      </div>
      <div class="resItemBox resItemBoxBooks">
        <table><tr class="bookRow">
          <td>
            <h3 itemprop="name"><a href="/book/cuentos-de-los-viudos-negros">Cuentos de los viudos negros</a></h3>
            <div class="authors"><a class="color1" href="/author/Asimov">Asimov</a></div>
            <div class="bookProperty"><span>File:</span> <span>PDF</span></div>
          </td>
        </tr></table>
      </div>
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rank: 1,
      title: 'Tales of the Black Widowers',
      author: 'Asimov, Isaac',
      year: '1974',
      language: 'English',
      format: 'EPUB',
      url: 'https://z-lib.id/book/tales-of-the-black-widowers',
    });
    expect(rows[1]).toMatchObject({ rank: 2, format: 'PDF', url: 'https://z-lib.id/book/cuentos-de-los-viudos-negros' });
  });

  it('extracts z-bookcard results whose link lives in a shadow root', () => {
    const dom = new JSDOM('<div id="results"></div>', { url: 'https://z-lib.id/s/test' });
    const { document } = dom.window;
    const card = document.createElement('z-bookcard');
    card.textContent = 'More Tales of the Black Widowers\nAsimov, Isaac';
    const shadow = card.attachShadow({ mode: 'open' });
    const link = document.createElement('a');
    link.setAttribute('href', 'https://z-lib.id/book/more-tales');
    link.textContent = 'More Tales of the Black Widowers';
    shadow.appendChild(link);
    document.getElementById('results').appendChild(card);

    const script = buildSearchExtractScript(10);
    const rows = JSON.parse(Function('window', 'document', `return (${script});`)(dom.window, document));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rank: 1,
      title: 'More Tales of the Black Widowers',
      author: 'Asimov, Isaac',
      url: 'https://z-lib.id/book/more-tales',
    });
  });

  it('respects the limit and drops rows without a title or URL', () => {
    const html = Array.from({ length: 5 }, (_, index) => `
      <div class="resItemBox">
        <h3 itemprop="name"><a href="/book/b${index}">Book ${index}</a></h3>
      </div>
    `).join('') + '<div class="resItemBox"><h3>No link here</h3></div>';

    expect(runExtract(html, 3)).toHaveLength(3);
    expect(runExtract(html, 25)).toHaveLength(5);
  });

});

describe('zlibrary mirror fallback', () => {

  function fakePage({ deadHosts, rowsByHost }) {
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (script) => {
        const host = new URL(page.currentUrl).hostname;
        if (deadHosts.includes(host)) {
          return JSON.stringify({ url: 'chrome-error://chromewebdata/', nodes: 0 });
        }
        if (script.includes('nodes:')) {
          return JSON.stringify({ url: page.currentUrl, nodes: 2 });
        }
        return JSON.stringify(rowsByHost[host] || []);
      }),
    };
    page.goto = vi.fn(async (url) => {
      page.currentUrl = url;
    });
    return page;
  }

  it('skips an unreachable mirror and returns rows from the next one', async () => {
    const page = fakePage({
      deadHosts: ['z-library.sk'],
      rowsByHost: {
        'z-lib.id': [{ rank: 1, title: 'Tales of the Black Widowers', author: 'Asimov, Isaac', url: 'https://z-lib.id/book/x' }],
      },
    });

    const rows = await runSearch(page, {
      query: 'tales',
      limit: 5,
      mirrors: ['z-library.sk', 'z-lib.id'],
    });

    expect(rows).toEqual([
      {
        rank: 1,
        title: 'Tales of the Black Widowers',
        author: 'Asimov, Isaac',
        url: 'https://z-lib.id/book/x',
        mirror: 'z-lib.id',
      },
    ]);
    expect(page.goto).toHaveBeenCalledTimes(3);
    // Only the live mirror may run the extraction script; the dead one gets a
    // single probe. 'Language:' only appears in the extraction script.
    const extractCalls = page.evaluate.mock.calls.filter(call => String(call[0]).includes('Language:'));
    expect(extractCalls).toHaveLength(1);
  });

  it('tries both search URL shapes before giving up on a mirror', async () => {
    const page = fakePage({ deadHosts: [], rowsByHost: {} });
    page.evaluate = vi.fn(async (script) => {
      if (script.includes('nodes:')) return JSON.stringify({ url: page.currentUrl, nodes: 2 });
      return JSON.stringify(page.currentUrl.includes('/s?q=') ? [] : [{ rank: 1, title: 'Row', url: 'https://z-lib.id/book/y' }]);
    });
    page.goto = vi.fn(async (url) => {
      page.currentUrl = url;
    });

    const rows = await runSearch(page, { query: 'x', limit: 5, mirrors: ['z-lib.id'] });

    expect(rows).toHaveLength(1);
    expect(page.goto.mock.calls.map(call => call[0])).toEqual([
      'https://z-lib.id/s?q=x',
      'https://z-lib.id/s/x',
    ]);
  });

  it('reports every attempt when no mirror yields results', async () => {
    const page = fakePage({ deadHosts: ['a.example', 'b.example'], rowsByHost: {} });
    page.evaluate = vi.fn(async () => JSON.stringify({ url: 'chrome-error://chromewebdata/', nodes: 0 }));

    await expect(
      runSearch(page, { query: 'x', limit: 5, mirrors: ['a.example', 'b.example'] }),
    ).rejects.toThrow(EmptyResultError);
  });

  it('rejects an empty --mirror and an empty mirror list instead of falling back silently', async () => {
    expect(() => readMirror('')).toThrow(ArgumentError);
    expect(() => readMirror('   ')).toThrow(ArgumentError);
    expect(readMirror(' z-lib.id ')).toBe('z-lib.id');

    const page = fakePage({ deadHosts: [], rowsByHost: {} });
    await expect(runSearch(page, { query: 'x', limit: 5, mirrors: [] })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range limit instead of clamping it', async () => {
    const page = fakePage({ deadHosts: [], rowsByHost: {} });
    await expect(runSearch(page, { query: 'x', limit: 999, mirrors: ['z-lib.id'] })).rejects.toThrow(ArgumentError);
    await expect(runSearch(page, { query: 'x', limit: 0, mirrors: ['z-lib.id'] })).rejects.toThrow(ArgumentError);
    await expect(runSearch(page, { query: 'x', limit: 'abc', mirrors: ['z-lib.id'] })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects an empty query before opening the browser', async () => {
    const page = fakePage({ deadHosts: [], rowsByHost: {} });
    await expect(runSearch(page, { query: '   ', limit: 5, mirrors: ['z-lib.id'] })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

});
