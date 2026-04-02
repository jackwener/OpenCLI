import { describe, it, expect } from 'vitest';
import { autoScrollJs, waitForCaptureJs, waitForSelectorJs, waitForStreamCaptureJs } from './dom-helpers.js';

describe('autoScrollJs', () => {
  it('returns early without error when document.body is null', async () => {
    const g = globalThis as any;
    const origDoc = g.document;
    g.document = { body: null, documentElement: {} };
    g.window = g;
    const code = autoScrollJs(3, 500);
    // Should resolve without throwing
    await expect(eval(code)).resolves.not.toThrow();
    g.document = origDoc;
    delete g.window;
  });
});

describe('waitForCaptureJs', () => {
  it('returns a non-empty string', () => {
    const code = waitForCaptureJs(1000);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
    expect(code).toContain('__opencli_xhr');
    expect(code).toContain('resolve');
    expect(code).toContain('reject');
  });

  it('resolves "captured" when __opencli_xhr is populated before deadline', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [];
    g.window = g; // stub window for Node eval
    const code = waitForCaptureJs(1000);
    const promise = eval(code) as Promise<string>;
    g.__opencli_xhr.push({ data: 'test' });
    await expect(promise).resolves.toBe('captured');
    delete g.__opencli_xhr;
    delete g.window;
  });

  it('rejects when __opencli_xhr stays empty past deadline', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [];
    g.window = g;
    const code = waitForCaptureJs(50); // 50ms timeout
    const promise = eval(code) as Promise<string>;
    await expect(promise).rejects.toThrow('No network capture within 0.05s');
    delete g.__opencli_xhr;
    delete g.window;
  });

  it('resolves immediately when __opencli_xhr already has data', async () => {
    const g = globalThis as any;
    g.__opencli_xhr = [{ data: 'already here' }];
    g.window = g;
    const code = waitForCaptureJs(1000);
    await expect(eval(code) as Promise<string>).resolves.toBe('captured');
    delete g.__opencli_xhr;
    delete g.window;
  });
});

describe('waitForSelectorJs', () => {
  it('returns a non-empty string', () => {
    const code = waitForSelectorJs('#app', 1000);
    expect(typeof code).toBe('string');
    expect(code).toContain('#app');
    expect(code).toContain('querySelector');
    expect(code).toContain('MutationObserver');
  });

  it('resolves "found" immediately when selector already present', async () => {
    const g = globalThis as any;
    const fakeEl = { tagName: 'DIV' };
    g.document = { querySelector: (_: string) => fakeEl };
    const code = waitForSelectorJs('[data-testid="primaryColumn"]', 1000);
    await expect(eval(code) as Promise<string>).resolves.toBe('found');
    delete g.document;
  });

  it('resolves "found" when selector appears after DOM mutation', async () => {
    const g = globalThis as any;
    let mutationCallback!: () => void;
    g.MutationObserver = class {
      constructor(cb: () => void) { mutationCallback = cb; }
      observe() {}
      disconnect() {}
    };
    let calls = 0;
    g.document = {
      querySelector: (_: string) => (calls++ > 0 ? { tagName: 'DIV' } : null),
      body: {},
    };
    const code = waitForSelectorJs('#app', 1000);
    const promise = eval(code) as Promise<string>;
    mutationCallback(); // simulate DOM mutation
    await expect(promise).resolves.toBe('found');
    delete g.document;
    delete g.MutationObserver;
  });

  it('rejects when selector never appears within timeout', async () => {
    const g = globalThis as any;
    g.MutationObserver = class {
      constructor(_cb: () => void) {}
      observe() {}
      disconnect() {}
    };
    g.document = { querySelector: (_: string) => null, body: {} };
    const code = waitForSelectorJs('#missing', 50);
    await expect(eval(code) as Promise<string>).rejects.toThrow('Selector not found: #missing');
    delete g.document;
    delete g.MutationObserver;
  });
});

describe('waitForStreamCaptureJs', () => {
  it('returns a non-empty string with default prefix', () => {
    const code = waitForStreamCaptureJs(1000);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
    expect(code).toContain('__opencli_stream_text');
    expect(code).toContain('__opencli_stream_done');
  });

  it('generates code that resolves when minChars is reached', async () => {
    const g = globalThis as any;
    g.__opencli_stream_text = '';
    g.__opencli_stream_done = false;
    g.window = g;
    const code = waitForStreamCaptureJs(1000, { minChars: 5 });
    const promise = eval(code) as Promise<void>;
    // Simulate data arriving
    g.__opencli_stream_text = 'hello world';
    await expect(promise).resolves.not.toThrow();
    delete g.__opencli_stream_text;
    delete g.__opencli_stream_done;
    delete g.window;
  });

  it('generates code that resolves when done flag is set', async () => {
    const g = globalThis as any;
    g.__opencli_stream_text = '';
    g.__opencli_stream_done = false;
    g.window = g;
    const code = waitForStreamCaptureJs(1000, { waitForDone: true });
    const promise = eval(code) as Promise<void>;
    // Simulate stream completion — need both minChars AND done
    g.__opencli_stream_text = 'data arrived';
    g.__opencli_stream_done = true;
    await expect(promise).resolves.not.toThrow();
    delete g.__opencli_stream_text;
    delete g.__opencli_stream_done;
    delete g.window;
  });

  it('generates code that rejects on timeout', async () => {
    const g = globalThis as any;
    g.__opencli_stream_text = '';
    g.__opencli_stream_done = false;
    g.window = g;
    const code = waitForStreamCaptureJs(50, { minChars: 100, waitForDone: true });
    const promise = eval(code) as Promise<void>;
    await expect(promise).rejects.toThrow();
    delete g.__opencli_stream_text;
    delete g.__opencli_stream_done;
    delete g.window;
  });

  it('uses custom prefix when provided', () => {
    const code = waitForStreamCaptureJs(1000, { prefix: '__my_prefix' });
    expect(code).toContain('__my_prefix_text');
    expect(code).toContain('__my_prefix_done');
    expect(code).not.toContain('__opencli_stream');
  });
});
