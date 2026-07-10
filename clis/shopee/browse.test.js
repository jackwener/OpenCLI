import { describe, expect, it, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './browse.js';
import { __test__ as shared } from './browse-shared.js';

function createDom(html, url) {
  return new JSDOM(html, { url });
}

function createBrowsePageMock(domByUrl) {
  let currentUrl = '';
  return {
    goto: vi.fn().mockImplementation(async (url) => {
      currentUrl = url;
    }),
    click: vi.fn().mockImplementation(async (selector) => {
      const dom = domByUrl[currentUrl];
      if (!dom) throw new Error(`No mock DOM for ${currentUrl}`);
      const anchor = dom.window.document.querySelector(selector);
      if (!(anchor instanceof dom.window.HTMLAnchorElement)) {
        throw new Error(`No clickable anchor for selector ${selector} on ${currentUrl}`);
      }
      currentUrl = anchor.href;
    }),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    getCurrentUrl: vi.fn().mockImplementation(async () => currentUrl),
    evaluate: vi.fn().mockImplementation(async (js) => {
      const dom = domByUrl[currentUrl];
      if (!dom) throw new Error(`No mock DOM for ${currentUrl}`);
      if (String(js).includes('__OPENCLI_SHOPEE_BROWSE_CLICK__')) {
        dom.window.document.querySelectorAll('[data-opencli-browse-next]').forEach((node) => {
          node.removeAttribute('data-opencli-browse-next');
        });
        const match = Array.from(dom.window.document.querySelectorAll('a[href]')).find((anchor) => anchor.href === /targetHref = "([^"]+)"/.exec(String(js))?.[1]);
        if (!match) return { ok: false, reason: 'anchor_not_found' };
        match.setAttribute('data-opencli-browse-next', '1');
        return { ok: true, selector: '[data-opencli-browse-next="1"]' };
      }
      if (String(js).trim() === 'window.location.href') return currentUrl;
      return shared.createBrowseInspectPayload(dom.window.document, currentUrl, 20);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shopee browse registration', () => {
  const command = getRegistry().get('shopee/browse');

  it('registers the command with the expected public shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('shopee');
    expect(command.name).toBe('browse');
    expect(command.workspace).toBe('browser:shopee-browse-{pid}');
    expect(command.domain).toBe('shopee.sg');
    expect(command.strategy).toBe('cookie');
    expect(command.navigateBefore).toBe(false);
    expect(command.timeoutSeconds).toBe(900);
    expect(command.columns).toEqual([
      'step',
      'status',
      'page_type',
      'title',
      'visited_url',
      'candidate_count',
      'selected_kind',
      'selected_url',
      'dwell_seconds',
    ]);
  });

  it('declares url, steps, inspect-limit, dwell bounds, and mock args', () => {
    expect(command.args).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'url', positional: true, required: true }),
      expect.objectContaining({ name: 'steps', type: 'int', default: 3 }),
      expect.objectContaining({ name: 'duration-min', type: 'int', default: 0 }),
      expect.objectContaining({ name: 'inspect-limit', type: 'int', default: 20 }),
      expect.objectContaining({ name: 'dwell-min-ms', type: 'int', default: 3500 }),
      expect.objectContaining({ name: 'dwell-max-ms', type: 'int', default: 6500 }),
      expect.objectContaining({ name: 'search-terms', default: 'shoes,shirt' }),
      expect.objectContaining({ name: 'mock', type: 'bool', default: false }),
      expect.objectContaining({ name: 'action-log', type: 'bool', default: false }),
    ]));
  });
});

describe('shopee browse shared helpers', () => {
  it('extracts search-style candidates from a mock Shopee page', () => {
    const dom = createDom(`
      <html data-opencli-mock="true">
        <body data-opencli-page-type="search">
          <h1>Camera Search</h1>
          <a data-opencli-role="product" href="/product/100/200">Camera A</a>
          <a data-opencli-role="product" href="/Kids-Camera-i.100.201">Camera B</a>
          <a data-opencli-role="shop" href="/shop/300">Camera Shop</a>
        </body>
      </html>
    `, 'https://mock.shopee.test/search?keyword=camera');
    const payload = shared.createBrowseInspectPayload(dom.window.document, dom.window.location.href, 10);

    expect(payload.pageType).toBe('search');
    expect(payload.title).toBe('Camera Search');
    expect(payload.candidates).toEqual([
      expect.objectContaining({ kind: 'product', href: 'https://mock.shopee.test/product/100/200' }),
      expect.objectContaining({ kind: 'product', href: 'https://mock.shopee.test/Kids-Camera-i.100.201' }),
      expect.objectContaining({ kind: 'shop', href: 'https://mock.shopee.test/shop/300' }),
    ]);
  });

  it('prefers unvisited same-host candidates when picking the next hop', () => {
    const candidate = shared.pickBrowseCandidate({
      pageType: 'product',
      candidates: [
        { kind: 'shop', href: 'https://mock.shopee.test/shop/300', same_host: true },
        { kind: 'similar', href: 'https://mock.shopee.test/product/101/201', same_host: true },
        { kind: 'similar', href: 'https://external.example/product/9/9', same_host: false },
      ],
    }, new Set(['https://mock.shopee.test/shop/300']), () => 0.1);

    expect(candidate).toEqual(expect.objectContaining({
      kind: 'similar',
      href: 'https://mock.shopee.test/product/101/201',
    }));
  });

  it('rejects non-Shopee hosts unless mock mode is enabled', () => {
    expect(() => shared.normalizeShopeeBrowseUrl('https://example.com/item/1')).toThrow('Shopee browse/inspect URL');
    expect(shared.normalizeShopeeBrowseUrl('https://mock.shopee.test/search', { allowMock: true })).toBe('https://mock.shopee.test/search');
  });

  it('filters out non-public account paths from browse candidates', () => {
    const dom = createDom(`
      <html data-opencli-mock="true">
        <body data-opencli-page-type="browse">
          <a href="/user/account/profile">Profile</a>
          <a href="/user/account/address">Address</a>
          <a href="/search?keyword=shoes">Shoes</a>
        </body>
      </html>
    `, 'https://mock.shopee.test/');
    const payload = shared.createBrowseInspectPayload(dom.window.document, dom.window.location.href, 10);
    expect(payload.candidates).toEqual([
      expect.objectContaining({ kind: 'search', href: 'https://mock.shopee.test/search?keyword=shoes' }),
    ]);
  });

  it('builds fallback public search seeds for the read-only duration plan', () => {
    expect(shared.buildSeedSearchUrls('https://shopee.sg/', 'shoe,shirt')).toEqual([
      {
        kind: 'search',
        href: 'https://shopee.sg/search?keyword=shoe',
        text: 'shoe',
        same_host: true,
      },
      {
        kind: 'search',
        href: 'https://shopee.sg/search?keyword=shirt',
        text: 'shirt',
        same_host: true,
      },
    ]);
  });

  it('builds an inspect script that can execute standalone in-page', () => {
    const dom = createDom(`
      <html>
        <body data-opencli-page-type="search">
          <h1>Camera Search</h1>
          <a data-opencli-role="product" href="/product/100/200">Camera A</a>
        </body>
      </html>
    `, 'https://mock.shopee.test/search?keyword=camera');
    const script = shared.buildBrowseInspectScript(10).trim();
    const result = Function('window', 'document', `return ${script}`)(dom.window, dom.window.document);
    expect(result).toEqual(expect.objectContaining({
      pageType: 'search',
      title: 'Camera Search',
      candidateCount: 1,
      candidates: [
        expect.objectContaining({
          kind: 'product',
          href: 'https://mock.shopee.test/product/100/200',
        }),
      ],
    }));
  });

  it('detects the NEW_CAPTCHA read-error container and extracts the reason text', () => {
    const dom = createDom(`
      <html>
        <body>
          <div id="NEW_CAPTCHA">
            <div class="QT8fQ2">
              <h1 class="eDksNk">读取时出现问题</h1>
              <div class="T8fvru">抱歉，我们在读取时出现一些问题，请再试一次。</div>
              <button class="cDUOQx">再试一次</button>
            </div>
          </div>
        </body>
      </html>
    `, 'https://shopee.sg/search?keyword=camera');
    expect(shared.detectBrowsePageIssue(dom.window.document)).toEqual({
      code: 'new_captcha',
      title: '读取时出现问题',
      message: '抱歉，我们在读取时出现一些问题，请再试一次。',
      retryLabel: '再试一次',
    });
  });
});

describe('shopee browse execution', () => {
  it('walks a mock browse session and records the chosen path', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="search">
            <h1>Camera Search</h1>
            <a data-opencli-role="product" href="/product/100/200">Camera A</a>
            <a data-opencli-role="product" href="/product/101/201">Camera B</a>
            <a data-opencli-role="shop" href="/shop/300">Camera Shop</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
      'https://mock.shopee.test/product/101/201': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Camera B</h1>
            <section data-opencli-section="similar">
              <a href="/product/102/202">Camera C</a>
              <a href="/product/103/203">Camera D</a>
            </section>
            <a data-opencli-role="shop" href="/shop/300">Visit Shop</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/101/201'),
      'https://mock.shopee.test/product/103/203': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Camera D</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/103/203'),
    };
    const page = createBrowsePageMock(domByUrl);

    const rows = await command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
      'inspect-limit': 10,
      'dwell-min-ms': 400,
      'dwell-max-ms': 400,
    });

    expect(page.goto.mock.calls).toEqual([
      ['https://mock.shopee.test/search?keyword=camera', { waitUntil: 'load' }],
    ]);
    expect(page.click.mock.calls).toEqual([
      ['[data-opencli-browse-next="1"]', { firstOnMulti: true }],
      ['[data-opencli-browse-next="1"]', { firstOnMulti: true }],
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        step: 1,
        status: 'ok',
        page_type: 'search',
        visited_url: 'https://mock.shopee.test/search?keyword=camera',
        selected_kind: 'product',
        selected_url: 'https://mock.shopee.test/product/101/201',
        dwell_seconds: 0.4,
      }),
      expect.objectContaining({
        step: 2,
        status: 'ok',
        page_type: 'product',
        visited_url: 'https://mock.shopee.test/product/101/201',
        selected_kind: 'similar',
        selected_url: 'https://mock.shopee.test/product/103/203',
        dwell_seconds: 0.4,
      }),
      expect.objectContaining({
        step: 3,
        status: 'ok',
        page_type: 'product',
        visited_url: 'https://mock.shopee.test/product/103/203',
        selected_kind: '',
        selected_url: '',
        dwell_seconds: 0,
      }),
    ]);
  });

  it('supports a duration-based read-only plan and falls back to public search seeds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { runBrowseSession } = await import('./browse.js').then((m) => m.__test__);
    const domByUrl = {
      'https://mock.shopee.test/': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="browse">
            <h1>Mock Home</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/'),
      'https://mock.shopee.test/search?keyword=shoe': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="search">
            <h1>Shoe Search</h1>
            <a data-opencli-role="product" href="/product/100/200">Shoe A</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=shoe'),
      'https://mock.shopee.test/product/100/200': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Shoe A</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/100/200'),
    };
    const page = createBrowsePageMock(domByUrl);
    const times = [0, 0, 60_000, 60_000, 300_000, 300_000, 599_000, 601_000];
    const nowFn = () => times.shift() ?? 601_000;

    const rows = await runBrowseSession(page, {
      url: 'https://mock.shopee.test/',
      steps: 20,
      'duration-min': 10,
      mock: true,
      'search-terms': 'shoe,shirt',
      'dwell-min-ms': 400,
      'dwell-max-ms': 400,
    }, { nowFn });

    expect(page.goto.mock.calls).toEqual([
      ['https://mock.shopee.test/', { waitUntil: 'load' }],
      ['https://mock.shopee.test/search?keyword=shoe', { waitUntil: 'load' }],
    ]);
    expect(page.click.mock.calls).toEqual([
      ['[data-opencli-browse-next="1"]', { firstOnMulti: true }],
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        step: 1,
        status: 'ok',
        page_type: 'browse',
        selected_kind: 'search',
        selected_url: 'https://mock.shopee.test/search?keyword=shoe',
      }),
      expect.objectContaining({
        step: 2,
        status: 'ok',
        page_type: 'search',
        selected_kind: 'product',
        selected_url: 'https://mock.shopee.test/product/100/200',
      }),
      expect.objectContaining({
        step: 3,
        status: 'ok',
        page_type: 'product',
        selected_kind: '',
        selected_url: '',
      }),
    ]);
  });

  it('falls back to goto when the selected same-host candidate no longer exists in the DOM', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="search">
            <h1>Camera Search</h1>
            <a data-opencli-role="product" href="/product/100/200">Camera A</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
      'https://mock.shopee.test/product/100/200': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Camera A</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/100/200'),
    };
    const page = createBrowsePageMock(domByUrl);
    page.evaluate = vi.fn().mockImplementation(async (js) => {
      const dom = domByUrl[await page.getCurrentUrl()];
      if (!dom) throw new Error('No DOM for fallback test');
      if (String(js).includes('__OPENCLI_SHOPEE_BROWSE_CLICK__')) {
        return { ok: false, reason: 'anchor_not_found' };
      }
      if (String(js).trim() === 'window.location.href') return await page.getCurrentUrl();
      return shared.createBrowseInspectPayload(dom.window.document, await page.getCurrentUrl(), 20);
    });

    const rows = await command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 2,
      mock: true,
      'dwell-min-ms': 400,
      'dwell-max-ms': 400,
    }, { hopTimeoutMs: 50 });

    expect(page.goto.mock.calls).toEqual([
      ['https://mock.shopee.test/search?keyword=camera', { waitUntil: 'load' }],
      ['https://mock.shopee.test/product/100/200', { waitUntil: 'load' }],
    ]);
    expect(page.click).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({ step: 1, selected_url: 'https://mock.shopee.test/product/100/200' }),
      expect.objectContaining({ step: 2, visited_url: 'https://mock.shopee.test/product/100/200' }),
    ]);
  });

  it('falls back to goto when click executes but the URL never changes to the selected target', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="search">
            <h1>Camera Search</h1>
            <a data-opencli-role="product" href="/product/100/200">Camera A</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
      'https://mock.shopee.test/product/100/200': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Camera A</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/100/200'),
    };
    const page = createBrowsePageMock(domByUrl);
    page.click = vi.fn().mockResolvedValue(undefined);

    const rows = await command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 2,
      mock: true,
      'dwell-min-ms': 400,
      'dwell-max-ms': 400,
    }, { hopTimeoutMs: 50 });

    expect(page.click).toHaveBeenCalledWith('[data-opencli-browse-next="1"]', { firstOnMulti: true });
    expect(page.goto.mock.calls).toEqual([
      ['https://mock.shopee.test/search?keyword=camera', { waitUntil: 'load' }],
      ['https://mock.shopee.test/product/100/200', { waitUntil: 'load' }],
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ step: 1, selected_url: 'https://mock.shopee.test/product/100/200' }),
      expect.objectContaining({ step: 2, visited_url: 'https://mock.shopee.test/product/100/200' }),
    ]);
  });

  it('stops and returns status unlogin when Shopee shows the unavailable not-logged-in page', async () => {
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <head><title>Page Unavailable</title></head>
          <body>
            <h1>Page Unavailable</h1>
            <p>Looks like you’re not logged in yet. Log in to continue or head back to the homepage.</p>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
    };
    const page = createBrowsePageMock(domByUrl);

    await expect(command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
    })).resolves.toEqual([
      expect.objectContaining({
        step: 1,
        status: 'unlogin',
        title: 'Page Unavailable',
        visited_url: 'https://mock.shopee.test/search?keyword=camera',
        selected_kind: '',
        selected_url: '',
        dwell_seconds: 0,
      }),
    ]);
  });

  it('returns status unlogin even when the not-logged-in page has no title heading', async () => {
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body>
            <div>Looks like you’re not logged in yet.</div>
            <div>Log in to continue or head back to the homepage.</div>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
    };
    const page = createBrowsePageMock(domByUrl);

    await expect(command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
    })).resolves.toEqual([
      expect.objectContaining({
        step: 1,
        status: 'unlogin',
        title: 'Page Unavailable',
        visited_url: 'https://mock.shopee.test/search?keyword=camera',
      }),
    ]);
  });

  it('stops immediately when the page exposes the NEW_CAPTCHA read error', async () => {
    const command = getRegistry().get('shopee/browse');
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body>
            <div id="NEW_CAPTCHA">
              <div class="QT8fQ2">
                <h1 class="eDksNk">读取时出现问题</h1>
                <div class="T8fvru">抱歉，我们在读取时出现一些问题，请再试一次。</div>
              </div>
            </div>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
    };
    const page = createBrowsePageMock(domByUrl);

    await expect(command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
    })).rejects.toThrow('读取时出现问题');
  });

  it('emits stable action logs to stderr when action-log is enabled', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const command = getRegistry().get('shopee/browse');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="search">
            <h1>Camera Search</h1>
            <a data-opencli-role="product" href="/product/100/200">Camera A</a>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
      'https://mock.shopee.test/product/100/200': createDom(`
        <html data-opencli-mock="true">
          <body data-opencli-page-type="product">
            <h1>Camera A</h1>
          </body>
        </html>
      `, 'https://mock.shopee.test/product/100/200'),
    };
    const page = createBrowsePageMock(domByUrl);

    await command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 2,
      mock: true,
      'action-log': true,
      'dwell-min-ms': 400,
      'dwell-max-ms': 400,
    });

    const output = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('action:session_start');
    expect(output).toContain('action:step_start step:1');
    expect(output).toContain('action:navigate_start step:1 url:https://mock.shopee.test/search?keyword=camera');
    expect(output).toContain('action:inspect_done step:1 page_type:search candidates:1');
    expect(output).toContain('action:status value:ok');
    expect(output).toContain('action:select_done step:1 page_type:search selected_kind:product');
    expect(output).toContain('action:dwell_done step:1 seconds:0.4');
    expect(output).toContain('action:session_done rows:2');
  });

  it('emits not_ok status when the page exposes the NEW_CAPTCHA read error', async () => {
    const command = getRegistry().get('shopee/browse');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <body>
            <div id="NEW_CAPTCHA">
              <div class="QT8fQ2">
                <h1 class="eDksNk">读取时出现问题</h1>
                <div class="T8fvru">抱歉，我们在读取时出现一些问题，请再试一次。</div>
              </div>
            </div>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
    };
    const page = createBrowsePageMock(domByUrl);

    await expect(command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
      'action-log': true,
    })).rejects.toThrow('读取时出现问题');

    const output = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('action:status value:not_ok reason:new_captcha');
  });

  it('emits unlogin status when Shopee shows the unavailable not-logged-in page', async () => {
    const command = getRegistry().get('shopee/browse');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const domByUrl = {
      'https://mock.shopee.test/search?keyword=camera': createDom(`
        <html data-opencli-mock="true">
          <head><title>Page Unavailable</title></head>
          <body>
            <h1>Page Unavailable</h1>
            <p>Looks like you’re not logged in yet. Log in to continue or head back to the homepage.</p>
          </body>
        </html>
      `, 'https://mock.shopee.test/search?keyword=camera'),
    };
    const page = createBrowsePageMock(domByUrl);

    await expect(command.func(page, {
      url: 'https://mock.shopee.test/search?keyword=camera',
      steps: 3,
      mock: true,
      'action-log': true,
    })).resolves.toHaveLength(1);

    const output = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(output).toContain('action:status value:unlogin reason:unlogin');
    expect(output).toContain('action:session_stop reason:unlogin step:1');
  });
});
