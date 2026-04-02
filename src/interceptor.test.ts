/**
 * Tests for interceptor.ts: JavaScript code generators for XHR/Fetch interception.
 */

import { describe, it, expect } from 'vitest';
import { generateInterceptorJs, generateReadInterceptedJs, generateTapInterceptorJs, generateStreamingInterceptorJs, generateReadStreamJs } from './interceptor.js';

describe('generateInterceptorJs', () => {
  it('generates valid JavaScript function source', () => {
    const js = generateInterceptorJs('"api/search"');
    expect(js).toContain('window.fetch');
    expect(js).toContain('XMLHttpRequest');
    expect(js).toContain('"api/search"');
    // Should be a function expression wrapping
    expect(js.trim()).toMatch(/^\(\)\s*=>/);
  });

  it('uses default array name and patch guard', () => {
    const js = generateInterceptorJs('"test"');
    expect(js).toContain('__opencli_intercepted');
    expect(js).toContain('__opencli_interceptor_patched');
  });

  it('uses custom array name and patch guard', () => {
    const js = generateInterceptorJs('"test"', {
      arrayName: '__my_data',
      patchGuard: '__my_guard',
    });
    expect(js).toContain('__my_data');
    expect(js).toContain('__my_guard');
    expect(js).not.toContain('__opencli_intercepted');
  });

  it('includes fetch clone and json parsing', () => {
    const js = generateInterceptorJs('"api"');
    expect(js).toContain('response.clone()');
    expect(js).toContain('clone.json()');
  });

  it('includes XHR open and send patching', () => {
    const js = generateInterceptorJs('"api"');
    expect(js).toContain('XMLHttpRequest.prototype');
    expect(js).toContain('__origOpen');
    expect(js).toContain('__origSend');
  });
});

describe('generateReadInterceptedJs', () => {
  it('generates valid JavaScript to read and clear data', () => {
    const js = generateReadInterceptedJs();
    expect(js).toContain('__opencli_intercepted');
    // Should clear the array after reading
    expect(js).toContain('= []');
  });

  it('uses custom array name', () => {
    const js = generateReadInterceptedJs('__custom_arr');
    expect(js).toContain('__custom_arr');
    expect(js).not.toContain('__opencli_intercepted');
  });
});

describe('generateTapInterceptorJs', () => {
  it('returns all required fields', () => {
    const tap = generateTapInterceptorJs('"api/data"');

    expect(tap.setupVar).toBeDefined();
    expect(tap.capturedVar).toBe('captured');
    expect(tap.promiseVar).toBe('capturePromise');
    expect(tap.resolveVar).toBe('captureResolve');
    expect(tap.fetchPatch).toBeDefined();
    expect(tap.xhrPatch).toBeDefined();
    expect(tap.restorePatch).toBeDefined();
  });

  it('contains the capture pattern in setup', () => {
    const tap = generateTapInterceptorJs('"my-pattern"');
    expect(tap.setupVar).toContain('"my-pattern"');
  });

  it('restores original fetch and XHR in restorePatch', () => {
    const tap = generateTapInterceptorJs('"test"');
    expect(tap.restorePatch).toContain('origFetch');
    expect(tap.restorePatch).toContain('origXhrOpen');
    expect(tap.restorePatch).toContain('origXhrSend');
  });

  it('uses first-match capture (only first response)', () => {
    const tap = generateTapInterceptorJs('"test"');
    // Both fetch and xhr patches should check !captured before storing
    expect(tap.fetchPatch).toContain('!captured');
    expect(tap.xhrPatch).toContain('!captured');
  });
});

describe('generateStreamingInterceptorJs', () => {
  it('generates valid JavaScript function source', () => {
    const js = generateStreamingInterceptorJs('"api/stream"');
    expect(js.trim()).toMatch(/^\(\)\s*=>/);
    expect(js).toContain('"api/stream"');
  });

  it('initializes all streaming state variables', () => {
    const js = generateStreamingInterceptorJs('"test"');
    expect(js).toContain('__opencli_stream_text');
    expect(js).toContain('__opencli_stream_events');
    expect(js).toContain('__opencli_stream_done');
    expect(js).toContain('__opencli_stream_errors');
    expect(js).toContain('__opencli_stream_sse_buf');
  });

  it('resets SSE buffer on install', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // SSE buffer should be reset at initialization time
    expect(js).toContain('__opencli_stream_sse_buf');
    expect(js).toContain("= ''");
  });

  it('resets all state including SSE buffer on each new matching fetch', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // Inside the fetch patch, SSE buffer should be cleared for new request
    const fetchResetCount = (js.match(/__opencli_stream_sse_buf/g) || []).length;
    // Should appear at least twice: init + fetch reset + XHR reset
    expect(fetchResetCount).toBeGreaterThanOrEqual(2);
  });

  it('patches both fetch and XHR', () => {
    const js = generateStreamingInterceptorJs('"test"');
    expect(js).toContain('window.fetch');
    expect(js).toContain('XMLHttpRequest.prototype');
    expect(js).toContain('onprogress');
    expect(js).toContain('readystatechange');
  });

  it('normalizes CRLF in SSE parsing', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // SSE parser should normalize \r\n to \n
    expect(js).toContain(String.raw`replace(/\r\n/g, '\n')`);
  });

  it('normalizes CRLF in fetch SSE boundary detection', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // Fetch path should normalize CRLF before SSE boundary splitting
    expect(js).toContain('sseBuffer');
    expect(js).toContain(String.raw`replace(/\r\n/g, '\n')`);
  });

  it('normalizes CRLF in XHR SSE boundary detection', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // XHR progress path should normalize CRLF
    expect(js).toContain(String.raw`chunk.replace(/\r\n/g, '\n')`);
  });

  it('includes SSE parser function', () => {
    const js = generateStreamingInterceptorJs('"test"');
    expect(js).toContain('__parseSse');
    expect(js).toContain('event:');
    expect(js).toContain('data:');
  });

  it('uses custom prefix and patch guard', () => {
    const js = generateStreamingInterceptorJs('"test"', {
      arrayName: '__my_stream',
      patchGuard: '__my_stream_guard',
    });
    expect(js).toContain('__my_stream_text');
    expect(js).toContain('__my_stream_events');
    expect(js).toContain('__my_stream_guard');
    expect(js).not.toContain('__opencli_stream');
  });

  it('uses custom maxChunks', () => {
    const js = generateStreamingInterceptorJs('"test"', { maxChunks: 100 });
    expect(js).toContain('100');
  });

  it('XHR readystatechange uses authoritative responseText overwrite', () => {
    const js = generateStreamingInterceptorJs('"test"');
    // readystatechange readyState=4 should overwrite with full responseText
    expect(js).toContain('readyState === 4');
    expect(js).toContain('window.__opencli_stream_text = full');
  });

  it('XHR load event is guarded by settled flag', () => {
    const js = generateStreamingInterceptorJs('"test"');
    expect(js).toContain('if (settled) return');
  });
});

describe('generateReadStreamJs', () => {
  it('generates valid JavaScript to read streaming state', () => {
    const js = generateReadStreamJs();
    expect(js.trim()).toMatch(/^\(\)\s*=>/);
    expect(js).toContain('__opencli_stream_text');
    expect(js).toContain('__opencli_stream_events');
    expect(js).toContain('__opencli_stream_done');
    expect(js).toContain('__opencli_stream_errors');
  });

  it('clears all state including SSE buffer by default', () => {
    const js = generateReadStreamJs();
    expect(js).toContain('__opencli_stream_text');
    expect(js).toContain('__opencli_stream_sse_buf');
    expect(js).toContain("= ''");
    expect(js).toContain('= []');
  });

  it('does not clear state when clear=false (peek mode)', () => {
    const js = generateReadStreamJs('__opencli_stream', false);
    // Should NOT contain clearing statements
    expect(js).not.toContain("window.__opencli_stream_text = ''");
    expect(js).not.toContain("window.__opencli_stream_sse_buf = ''");
    // But should still contain the read statements
    expect(js).toContain('__opencli_stream_text');
  });

  it('uses custom prefix', () => {
    const js = generateReadStreamJs('__my_prefix');
    expect(js).toContain('__my_prefix_text');
    expect(js).toContain('__my_prefix_events');
    expect(js).not.toContain('__opencli_stream');
  });
});
