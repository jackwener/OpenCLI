import { describe, it, expect } from 'vitest';
import { autoScrollJs, networkRequestsJs, waitForCaptureJs, waitForSelectorJs } from './dom-helpers.js';

describe('autoScrollJs', () => {
  it('returns early without error when document.body is null', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
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
    const g = globalThis as unknown as Record<string, unknown>;
    const captured: unknown[] = [];
    g.__opencli_xhr = captured;
    g.window = g; // stub window for Node eval
    const code = waitForCaptureJs(1000);
    const promise = eval(code) as Promise<string>;
    captured.push({ data: 'test' });
    await expect(promise).resolves.toBe('captured');
    delete g.__opencli_xhr;
    delete g.window;
  });

  it('rejects when __opencli_xhr stays empty past deadline', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.__opencli_xhr = [];
    g.window = g;
    const code = waitForCaptureJs(50); // 50ms timeout
    const promise = eval(code) as Promise<string>;
    await expect(promise).rejects.toThrow('No network capture within 0.05s');
    delete g.__opencli_xhr;
    delete g.window;
  });

  it('resolves immediately when __opencli_xhr already has data', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
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
    const g = globalThis as unknown as Record<string, unknown>;
    const fakeEl = { tagName: 'DIV' };
    g.document = { querySelector: (_: string) => fakeEl };
    const code = waitForSelectorJs('[data-testid="primaryColumn"]', 1000);
    await expect(eval(code) as Promise<string>).resolves.toBe('found');
    delete g.document;
  });

  it('resolves "found" when selector appears after DOM mutation', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
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
    const g = globalThis as unknown as Record<string, unknown>;
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

describe('networkRequestsJs', () => {
  it('includes the main document navigation in the fallback request list', () => {
    const g = globalThis as any;
    const origPerformance = g.performance;
    const origDocument = g.document;

    g.performance = {
      getEntriesByType: (type: string) => {
        if (type === 'navigation') {
          return [{
            name: 'https://example.com/',
            duration: 123.4,
            transferSize: 321,
            encodedBodySize: 300,
            responseStatus: 200,
          }];
        }
        if (type === 'resource') return [];
        return [];
      },
    };
    g.document = { contentType: 'text/html' };

    const requests = eval(networkRequestsJs(false)) as Array<Record<string, unknown>>;

    expect(requests).toEqual([
      {
        url: 'https://example.com/',
        method: 'GET',
        type: 'navigation',
        duration: 123,
        size: 321,
        status: 200,
        responseStatus: 200,
        ct: 'text/html',
        responseContentType: 'text/html',
      },
    ]);

    g.performance = origPerformance;
    g.document = origDocument;
  });
});
