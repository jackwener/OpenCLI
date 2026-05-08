import { describe, expect, it, vi } from 'vitest';
import { CliError } from '../errors.js';
import { BasePage } from './base-page.js';
import { TargetError } from './target-errors.js';

class TestPage extends BasePage {
  result: unknown;
  args: Record<string, unknown> | undefined;

  async goto(): Promise<void> {}
  async evaluate(): Promise<unknown> { return null; }
  override async evaluateWithArgs(_js: string, args: Record<string, unknown>): Promise<unknown> {
    this.args = args;
    return this.result;
  }
  async getCookies(): Promise<[]> { return []; }
  async screenshot(): Promise<string> { return ''; }
  async tabs(): Promise<unknown[]> { return []; }
  async selectTab(): Promise<void> {}
}

class ActionPage extends BasePage {
  results: unknown[] = [];
  withArgsResults: unknown[] = [];
  scripts: string[] = [];
  withArgs: Record<string, unknown>[] = [];
  nativeType?: (text: string) => Promise<void>;
  insertText?: (text: string) => Promise<void>;
  nativeKeyPress?: (key: string, modifiers?: string[]) => Promise<void>;
  nativeClick?: (x: number, y: number) => Promise<void>;
  cdp?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;

  async goto(): Promise<void> {}
  async evaluate(js: string): Promise<unknown> {
    this.scripts.push(js);
    return this.results.shift() ?? null;
  }
  override async evaluateWithArgs(js: string, args: Record<string, unknown>): Promise<unknown> {
    this.scripts.push(js);
    this.withArgs.push(args);
    return this.withArgsResults.shift() ?? null;
  }
  async getCookies(): Promise<[]> { return []; }
  async screenshot(): Promise<string> { return ''; }
  async tabs(): Promise<unknown[]> { return []; }
  async selectTab(): Promise<void> {}
}

const resolveOk = { ok: true, matches_n: 1, match_level: 'exact' };

describe('BasePage.fetchJson', () => {
  it('passes a narrow browser-context JSON request and parses the response in Node', async () => {
    const page = new TestPage();
    page.result = {
      ok: true,
      status: 200,
      url: 'https://api.example.com/items',
      contentType: 'application/json',
      text: '{"items":[1]}',
    };

    await expect(page.fetchJson('https://api.example.com/items', {
      method: 'POST',
      headers: { 'X-Test': '1' },
      body: { q: 'opencli' },
      timeoutMs: 1234,
    })).resolves.toEqual({ items: [1] });

    expect(page.args).toEqual({
      request: {
        url: 'https://api.example.com/items',
        method: 'POST',
        headers: { 'X-Test': '1' },
        body: { q: 'opencli' },
        hasBody: true,
        timeoutMs: 1234,
      },
    });
  });

  it('throws a CliError for non-JSON responses', async () => {
    const page = new TestPage();
    page.result = {
      ok: true,
      status: 200,
      url: 'https://api.example.com/items',
      contentType: 'text/html',
      text: '<html>blocked</html>',
    };

    const err = await page.fetchJson('https://api.example.com/items').catch((error: unknown) => error);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('FETCH_ERROR');
    expect((err as CliError).message).toContain('Expected JSON');
    expect((err as CliError).hint).toContain('blocked');
  });

  it('throws a CliError for browser fetch transport errors', async () => {
    const page = new TestPage();
    page.result = {
      ok: false,
      status: 0,
      url: 'https://api.example.com/items',
      text: '',
      error: 'The operation was aborted.',
    };

    await expect(page.fetchJson('https://api.example.com/items')).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: expect.stringContaining('The operation was aborted.'),
    });
  });
});

describe('BasePage native input routing', () => {
  it('types rich-editor text via native Input.insertText when available', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockResolvedValue(undefined);
    page.results = [resolveOk, { ok: true, mode: 'contenteditable' }];

    await expect(page.typeText('#editor', 'hello')).resolves.toEqual({ matches_n: 1, match_level: 'exact' });

    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts).toHaveLength(2);
    expect(page.scripts[1]).toContain('nearestContentEditableHost');
    expect(page.scripts.join('\n')).not.toContain("return 'typed'");
  });

  it('uses CDP DOM focus and scroll before native text insertion when available', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockResolvedValue(undefined);
    page.cdp = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ root: { nodeId: 1 } })
      .mockResolvedValueOnce({ nodeId: 7 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ root: { nodeId: 1 } })
      .mockResolvedValueOnce({ nodeId: 7 })
      .mockResolvedValueOnce({});
    page.results = [resolveOk, { ok: true, mode: 'input' }];
    page.withArgsResults = [{ ok: true }, undefined, { ok: true }, undefined];

    await page.typeText('#q', 'hello');

    expect(page.cdp).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', { nodeId: 7 });
    expect(page.cdp).toHaveBeenCalledWith('DOM.focus', { nodeId: 7 });
    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts.at(-1)).toContain('if (false) el.scrollIntoView');
    expect(page.scripts.at(-1)).toContain('if (false) {');
  });

  it('keeps the DOM setter fallback when native text insertion is unavailable', async () => {
    const page = new ActionPage();
    page.results = [resolveOk, 'typed'];

    await page.typeText('#q', 'hello');

    expect(page.scripts).toHaveLength(2);
    expect(page.scripts[1]).toContain('document.execCommand');
    expect(page.scripts[1]).toContain("return 'typed'");
  });

  it('falls back to DOM typing if native text insertion fails', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockRejectedValue(new Error('native failed'));
    page.results = [resolveOk, { ok: true, mode: 'input' }, 'typed'];

    await page.typeText('#q', 'hello');

    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts).toHaveLength(3);
    expect(page.scripts[2]).toContain("return 'typed'");
  });

  it('fills text through the native input path and verifies the exact value', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockResolvedValue(undefined);
    page.results = [
      resolveOk,
      { ok: true, mode: 'textarea' },
      { ok: true, actual: 'line1\\n/ / raw', expected: 'line1\\n/ / raw', length: 14, mode: 'textarea' },
    ];

    await expect(page.fillText('#message', 'line1\\n/ / raw')).resolves.toEqual({
      filled: true,
      verified: true,
      expected: 'line1\\n/ / raw',
      actual: 'line1\\n/ / raw',
      length: 14,
      matches_n: 1,
      match_level: 'exact',
      mode: 'textarea',
    });

    expect(page.nativeType).toHaveBeenCalledWith('line1\\n/ / raw');
    expect(page.scripts).toHaveLength(3);
    expect(page.scripts[2]).toContain('actual ===');
  });

  it('falls back to the DOM setter when native fill insertion is unavailable', async () => {
    const page = new ActionPage();
    page.results = [
      resolveOk,
      { ok: true, mode: 'input' },
      'typed',
      { ok: true, actual: 'hello', expected: 'hello', length: 5, mode: 'input' },
    ];

    await expect(page.fillText('#q', 'hello')).resolves.toEqual(expect.objectContaining({
      filled: true,
      verified: true,
      actual: 'hello',
      mode: 'input',
    }));

    expect(page.scripts).toHaveLength(4);
    expect(page.scripts[2]).toContain("return 'typed'");
  });

  it('falls back to DOM fill if native insertion does not verify', async () => {
    const page = new ActionPage();
    page.nativeType = vi.fn().mockResolvedValue(undefined);
    page.results = [
      resolveOk,
      { ok: true, mode: 'input' },
      { ok: false, actual: '', expected: 'hello', length: 0, mode: 'input' },
      'typed',
      { ok: true, actual: 'hello', expected: 'hello', length: 5, mode: 'input' },
    ];

    await expect(page.fillText('#q', 'hello')).resolves.toEqual(expect.objectContaining({
      filled: true,
      verified: true,
      actual: 'hello',
    }));

    expect(page.nativeType).toHaveBeenCalledWith('hello');
    expect(page.scripts).toHaveLength(5);
    expect(page.scripts[3]).toContain("return 'typed'");
  });

  it('throws a structured not_editable error for non-fillable targets', async () => {
    const page = new ActionPage();
    page.results = [resolveOk, { ok: false, reason: 'not_editable', tag: 'button' }];

    const err = await page.fillText('button', 'hello').catch((error: unknown) => error);

    expect(err).toBeInstanceOf(TargetError);
    expect((err as TargetError).code).toBe('not_editable');
  });

  it('uses CDP DOM scrollIntoViewIfNeeded before measuring rect for click', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    page.cdp = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ root: { nodeId: 1 } })
      .mockResolvedValueOnce({ nodeId: 9 })
      .mockResolvedValueOnce({});
    page.results = [resolveOk, { x: 50, y: 100, w: 200, h: 32, visible: true }];
    page.withArgsResults = [{ ok: true }, undefined];

    await page.click('#save');

    expect(page.cdp).toHaveBeenCalledWith('DOM.scrollIntoViewIfNeeded', { nodeId: 9 });
    // After CDP scroll, boundingRectResolvedJs runs with skipScroll=true.
    expect(page.scripts.at(-1)).toContain('if (false) el.scrollIntoView');
  });

  it('clicks via CDP Input.dispatchMouseEvent when rect is visible', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    page.results = [resolveOk, { x: 50, y: 100, w: 200, h: 32, visible: true }];

    await page.click('#category');

    expect(page.nativeClick).toHaveBeenCalledWith(50, 100);
    expect(page.nativeClick).toHaveBeenCalledTimes(1);
    expect(page.scripts).toHaveLength(2);
    expect(page.scripts[1]).toContain('getBoundingClientRect');
    expect(page.scripts.join('\n')).not.toContain('el.click()');
  });

  it('clicks AX snapshot refs through backend node coordinates without DOM resolver', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    page.cdp = vi.fn(async (method: string) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Demo' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 10 },
          ],
        };
      }
      if (method === 'Page.getFrameTree') {
        return {
          frameTree: { frame: { id: 'root', url: 'https://app.example/' } },
        };
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [10, 20, 50, 20, 50, 40, 10, 40] } };
      }
      return {};
    });

    await expect(page.snapshot({ source: 'ax' })).resolves.toContain('[1]button "Submit"');
    await expect(page.click('1')).resolves.toEqual({ matches_n: 1, match_level: 'exact' });

    expect(page.cdp).toHaveBeenCalledWith('Accessibility.getFullAXTree', {});
    expect(page.cdp).toHaveBeenCalledWith('Page.getFrameTree', {});
    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 10 });
    expect(page.nativeClick).toHaveBeenCalledWith(30, 30);
    expect(page.scripts).toHaveLength(0);
  });

  it('adds same-origin iframe AX refs and clicks them by frame-scoped backend node', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    page.cdp = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Accessibility.getFullAXTree' && params?.frameId === 'same-frame') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Embedded' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Frame Save' }, backendDOMNodeId: 20 },
          ],
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Demo' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Main Save' }, backendDOMNodeId: 10 },
          ],
        };
      }
      if (method === 'Page.getFrameTree') {
        return {
          frameTree: {
            frame: { id: 'root', url: 'https://app.example/' },
            childFrames: [
              { frame: { id: 'same-frame', url: 'https://app.example/embed' } },
              { frame: { id: 'cross-frame', url: 'https://other.example/embed' } },
            ],
          },
        };
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [100, 200, 140, 200, 140, 220, 100, 220] } };
      }
      return {};
    });

    const snapshot = await page.snapshot({ source: 'ax' }) as string;
    expect(snapshot).toContain('[1]button "Main Save"');
    expect(snapshot).toContain('frame "https://app.example/embed":');
    expect(snapshot).toContain('[2]button "Frame Save"');

    await expect(page.click('2')).resolves.toEqual({ matches_n: 1, match_level: 'exact' });

    expect(page.cdp).toHaveBeenCalledWith('Accessibility.getFullAXTree', { frameId: 'same-frame' });
    expect(page.cdp).not.toHaveBeenCalledWith('Accessibility.getFullAXTree', { frameId: 'cross-frame' });
    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 20 });
    expect(page.nativeClick).toHaveBeenCalledWith(120, 210);
  });

  it('recovers stale iframe AX refs inside the original frame', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    let iframeAxCalls = 0;
    page.cdp = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Page.getFrameTree') {
        return {
          frameTree: {
            frame: { id: 'root', url: 'https://app.example/' },
            childFrames: [{ frame: { id: 'same-frame', url: 'https://app.example/embed' } }],
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree' && params?.frameId === 'same-frame') {
        iframeAxCalls++;
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Frame Save' }, backendDOMNodeId: iframeAxCalls === 1 ? 20 : 42 },
          ],
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Main Save' }, backendDOMNodeId: 10 },
          ],
        };
      }
      if (method === 'DOM.getBoxModel') {
        if (params?.backendNodeId === 20) throw new Error('No node with given id found');
        return { model: { content: [200, 300, 240, 300, 240, 320, 200, 320] } };
      }
      return {};
    });

    await page.snapshot({ source: 'ax' });
    await expect(page.click('2')).resolves.toEqual({ matches_n: 1, match_level: 'reidentified' });

    expect(page.cdp).toHaveBeenCalledWith('Accessibility.getFullAXTree', { frameId: 'same-frame' });
    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 20 });
    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 42 });
    expect(page.nativeClick).toHaveBeenCalledWith(220, 310);
  });

  it('recovers stale AX refs by role/name/nth before clicking', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    let axCalls = 0;
    page.cdp = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Accessibility.getFullAXTree') {
        axCalls++;
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Demo' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: axCalls === 1 ? 10 : 42 },
          ],
        };
      }
      if (method === 'DOM.getBoxModel') {
        if (params?.backendNodeId === 10) throw new Error('No node with given id found');
        return { model: { content: [100, 200, 140, 200, 140, 220, 100, 220] } };
      }
      return {};
    });

    await page.snapshot({ source: 'ax' });
    await expect(page.click('1')).resolves.toEqual({ matches_n: 1, match_level: 'reidentified' });

    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 10 });
    expect(page.cdp).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 42 });
    expect(page.nativeClick).toHaveBeenCalledWith(120, 210);
  });

  it('recovers AX refs across 10 repeated React-style rerenders', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    let currentBackendId = 100;
    const staleBackendIds = new Set<number>();
    page.cdp = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Demo' }, childIds: ['2'] },
            { nodeId: '2', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: currentBackendId },
          ],
        };
      }
      if (method === 'DOM.getBoxModel') {
        const id = params?.backendNodeId as number;
        if (staleBackendIds.has(id)) throw new Error('No node with given id found');
        return { model: { content: [id, id, id + 20, id, id + 20, id + 10, id, id + 10] } };
      }
      return {};
    });

    await page.snapshot({ source: 'ax' });
    for (let i = 0; i < 10; i++) {
      staleBackendIds.add(currentBackendId);
      currentBackendId += 1;
      await expect(page.click('1')).resolves.toEqual({ matches_n: 1, match_level: 'reidentified' });
    }

    expect(page.nativeClick).toHaveBeenCalledTimes(10);
  });

  it('falls back to JS el.click() when nativeClick is unavailable', async () => {
    const page = new ActionPage();
    page.results = [
      resolveOk,
      { x: 50, y: 100, w: 200, h: 32, visible: true },
      { status: 'clicked', x: 50, y: 100 },
    ];

    await page.click('#save');

    expect(page.scripts).toHaveLength(3);
    expect(page.scripts[1]).toContain('getBoundingClientRect');
    expect(page.scripts[2]).toContain('el.click()');
  });

  it('falls back to JS el.click() when rect is zero-area', async () => {
    const page = new ActionPage();
    page.nativeClick = vi.fn().mockResolvedValue(undefined);
    page.results = [
      resolveOk,
      { x: 0, y: 0, w: 0, h: 0, visible: false },
      { status: 'clicked', x: 0, y: 0 },
    ];

    await page.click('#hidden');

    expect(page.nativeClick).not.toHaveBeenCalled();
    expect(page.scripts).toHaveLength(3);
    expect(page.scripts[2]).toContain('el.click()');
  });

  it('retries CDP click when JS path throws but yields coordinates', async () => {
    const page = new ActionPage();
    const nativeClick = vi.fn()
      .mockRejectedValueOnce(new Error('cdp transient'))
      .mockResolvedValueOnce(undefined);
    page.nativeClick = nativeClick;
    page.results = [
      resolveOk,
      { x: 10, y: 20, w: 100, h: 30, visible: true },
      { status: 'js_failed', x: 10, y: 20, error: 'click intercepted' },
    ];

    await page.click('#flaky');

    expect(nativeClick).toHaveBeenCalledTimes(2);
    expect(nativeClick).toHaveBeenNthCalledWith(1, 10, 20);
    expect(nativeClick).toHaveBeenNthCalledWith(2, 10, 20);
  });

  it('presses key chords through native CDP key events when available', async () => {
    const page = new ActionPage();
    page.nativeKeyPress = vi.fn().mockResolvedValue(undefined);

    await page.pressKey('Control+a');

    expect(page.nativeKeyPress).toHaveBeenCalledWith('a', ['Ctrl']);
    expect(page.scripts).toHaveLength(0);
  });

  it('falls back to synthetic keyboard events with parsed modifiers', async () => {
    const page = new ActionPage();

    await page.pressKey('Meta+N');

    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]).toContain('key: "N"');
    expect(page.scripts[0]).toContain('metaKey: true');
  });
});
