import { createContext, runInContext } from 'node:vm';
import { describe, it, expect } from 'vitest';
import { generateStealthJs } from './stealth.js';

// Run patches in an isolated realm so Function/eval changes cannot leak into Vitest.
function realm(setup = '') {
  const context = createContext({});
  runInContext(`
    globalThis.window = globalThis;
    class EventTarget {}
    const navigator = { webdriver: true, plugins: [], languages: [] };
    const document = { $cdc_test: true, $chrome_test: true, keep: true };
    const Notification = { permission: 'denied' };
    class Permissions { query(p) { return Promise.resolve({ state: p.name }); } }
    window.Permissions = Permissions;
    class Performance {
      getEntries() { return [{ name: 'https://example.com/app.js' }, { name: 'devtools://trace' }]; }
      getEntriesByType() { return this.getEntries(); }
      getEntriesByName() { return this.getEntries(); }
    }
    class HTMLIFrameElement { get contentWindow() { return this.child ??= {}; } }
    window.outerWidth = 1600; window.innerWidth = 1000;
    window.outerHeight = 1200; window.innerHeight = 800;
    window.__playwright = true; window.__puppeteer = true; window.cdc_test = true;
    Object.defineProperty(Error.prototype, 'stack', {
      get() { return 'Error: test\\n at app.js:1\\n at pptr:trace'; }, configurable: true,
    });
    ${setup}
  `, context);
  return { run: (code: string) => runInContext(code, context), apply: () => runInContext(generateStealthJs(), context) };
}

describe('stealth behavior', () => {
  it('fills missing browser properties and applies only once', () => {
    const r = realm();
    expect(r.apply()).toBe('applied');
    expect(r.run('navigator.webdriver')).toBe(false);
    expect(r.run('navigator.plugins.namedItem("PDF Viewer").name')).toBe('PDF Viewer');
    expect(r.run('navigator.plugins.item(999)')).toBeNull();
    expect(r.run('navigator.languages.length')).toBeGreaterThan(0);
    expect(r.run('typeof chrome.runtime.onConnect.addListener')).toBe('function');
    expect(r.run('new HTMLIFrameElement().contentWindow.chrome === chrome')).toBe(true);
    expect(r.run('Object.keys(EventTarget.prototype)')).toEqual([]);
    expect(r.apply()).toBe('skipped');
  });

  it('preserves existing plugins, languages and chrome', () => {
    const r = realm(`navigator.plugins = ['real plugin']; navigator.languages = ['zh-CN'];
      window.chrome = { real: true }; window.outerWidth = 1080; window.outerHeight = 900;`);
    r.apply();
    expect(r.run('[navigator.plugins, navigator.languages, chrome, outerWidth, outerHeight]'))
      .toEqual([['real plugin'], ['zh-CN'], { real: true }, 1080, 900]);
  });

  it('normalizes notification permissions and forwards other permission queries', async () => {
    const r = realm(); r.apply();
    await expect(r.run('new Permissions().query({name: "notifications"})')).resolves.toMatchObject({ state: 'denied' });
    await expect(r.run('new Permissions().query({name: "camera"})')).resolves.toEqual({ state: 'camera' });
  });

  it('removes automation artifacts while preserving ordinary page data', () => {
    const r = realm(); r.apply();
    expect(r.run('[window.__playwright, window.__puppeteer, window.cdc_test, document.$cdc_test, document.$chrome_test]'))
      .toEqual(Array(5).fill(undefined));
    expect(r.run('document.keep')).toBe(true);
    expect(r.run('Error.prototype.stack')).toBe('Error: test\n at app.js:1');
    for (const method of ['getEntries', 'getEntriesByType', 'getEntriesByName']) {
      expect(r.run(`new Performance().${method}('resource')`)).toEqual([{ name: 'https://example.com/app.js' }]);
    }
    expect(r.run('[outerWidth, outerHeight]')).toEqual([1000, 920]);
  });

  it('keeps dynamic code working and disguises patched functions consistently', () => {
    const r = realm(); r.apply();
    expect(r.run(`Function('debugger; return 3')()`)).toBe(3);
    expect(r.run(`Function('debugger; return 3').toString()`)).not.toContain('debugger');
    expect(r.run(`new Function('x', 'debugger; return x + 1')(4)`)).toBe(5);
    expect(r.run(`eval('debugger; 6')`)).toBe(6);
    expect(r.run(`Function('return "use debugger mode"')()`)).toBe('use debugger mode');
    for (const fn of ['Function', 'eval', 'console.log']) {
      expect(r.run(`${fn}.toString()`)).toMatch(/\[native code\]/);
      expect(r.run(`Function.prototype.toString.call(${fn}) === ${fn}.toString()`)).toBe(true);
    }
  });
});
