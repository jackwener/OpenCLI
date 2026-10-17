import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { generateInterceptorJs, generateReadInterceptedJs, generateTapInterceptorJs } from './interceptor.js';

function realm() {
  const context = createContext({});
  runInContext(`
    globalThis.window = globalThis;
    window.fetch = async (url) => ({
      json: async () => ({ original: true }),
      clone: () => ({ json: async () => {
        if (url === '/api/bad') throw new Error('invalid JSON');
        return { url };
      } }),
    });
    class XMLHttpRequest {
      open() {}
      addEventListener(_, callback) { this.onLoad = callback; }
      send() { this.onLoad?.(); }
    }
    function request(url, responseText) {
      const xhr = new XMLHttpRequest(); xhr.open('GET', url);
      xhr.responseText = responseText; xhr.send();
    }
  `, context);
  return (code: string) => runInContext(code, context);
}

describe('generated interceptors', () => {
  it.each([undefined, { arrayName: '__custom', patchGuard: '__guard' }])(
    'captures matching fetch/XHR responses, updates the pattern and drains data (%j)', async (options) => {
      const run = realm();
      const install = (pattern: string) => run(`(${generateInterceptorJs(JSON.stringify(pattern), options)})()`);
      const read = () => run(`(${generateReadInterceptedJs(options?.arrayName)})()`);
      install('/api/');
      expect(read()).toEqual([]);
      await expect(run(`fetch('/api/first').then(r => r.json())`)).resolves.toEqual({ original: true });
      await run(`fetch('/unrelated')`);
      run(`request('/api/xhr', '{"xhr":true}')`);
      expect(read()).toEqual([{ url: '/api/first' }, { xhr: true }]);
      expect(read()).toEqual([]);
      run('window.savedFetch = fetch');
      install('/new/');
      expect(run('fetch === savedFetch')).toBe(true);
      await run(`fetch('/api/old'); fetch('/new/one')`);
      expect(read()).toEqual([{ url: '/new/one' }]);
      expect(run(`Object.keys(window).includes('${options?.arrayName ?? '__opencli_intercepted'}')`)).toBe(false);
    },
  );

  it('records malformed matching responses without consuming the caller response', async () => {
    const run = realm();
    run(`(${generateInterceptorJs('"/api/"')})()`);
    await expect(run(`fetch('/api/bad').then(r => r.json())`)).resolves.toEqual({ original: true });
    run(`request('/api/xhr', 'not json')`);
    expect(run('window.__opencli_intercepted')).toEqual([]);
    expect(run('window.__opencli_intercepted_errors')).toEqual([
      expect.objectContaining({ url: '/api/bad', error: expect.stringContaining('invalid JSON') }),
      expect.objectContaining({ url: '/api/xhr', error: expect.any(String) }),
    ]);
  });

  it.each(['fetch', 'xhr'])('tap captures only the first match and restores patches (%s)', async (transport) => {
    const run = realm();
    const tap = generateTapInterceptorJs('"/api/"');
    run('window.originals = [fetch, XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send]');
    const trigger = transport === 'fetch'
      ? `await fetch('/unrelated'); await fetch('/api/first'); await fetch('/api/second');`
      : `request('/unrelated', '{}'); request('/api/first', '{"url":"/api/first"}'); request('/api/second', '{}');`;
    const captured = await run(`(async () => {
      ${tap.setupVar} ${tap.fetchPatch} ${tap.xhrPatch}
      try { ${trigger} await ${tap.promiseVar}; return ${tap.capturedVar}; }
      finally { ${tap.restorePatch} }
    })()`);
    expect(captured).toEqual({ url: '/api/first' });
    expect(run('[fetch, XMLHttpRequest.prototype.open, XMLHttpRequest.prototype.send].every((fn, i) => fn === originals[i])')).toBe(true);
  });
});
