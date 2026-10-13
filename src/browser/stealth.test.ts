import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import { generateStealthJs } from './stealth.js';

/**
 * Tests for the stealth anti-detection module.
 *
 * Structure checks cover browser-specific patches. A fresh VM realm with
 * minimal browser globals also exercises eval semantics without modifying
 * the test runner's globals or requiring a live browser.
 */

describe('generateStealthJs', () => {
  it('returns a non-empty string', () => {
    const code = generateStealthJs();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('is a valid self-contained IIFE', () => {
    const code = generateStealthJs();
    // Should start/end as an IIFE
    expect(code.trim()).toMatch(/^\(\(\) => \{/);
    expect(code.trim()).toMatch(/\}\)\(\)$/);
  });

  it('patches navigator.webdriver', () => {
    const code = generateStealthJs();
    expect(code).toContain("navigator, 'webdriver'");
    expect(code).toContain('() => false');
  });

  it('stubs window.chrome', () => {
    const code = generateStealthJs();
    expect(code).toContain('window.chrome');
    expect(code).toContain('runtime');
    expect(code).toContain('loadTimes');
    expect(code).toContain('csi');
  });

  it('fakes navigator.plugins if empty', () => {
    const code = generateStealthJs();
    expect(code).toContain('navigator.plugins');
    expect(code).toContain('PDF Viewer');
    expect(code).toContain('Chrome PDF Viewer');
  });

  it('ensures navigator.languages is non-empty', () => {
    const code = generateStealthJs();
    expect(code).toContain('navigator.languages');
    expect(code).toContain("'en-US'");
  });

  it('normalizes Permissions.query for notifications', () => {
    const code = generateStealthJs();
    expect(code).toContain('Permissions');
    expect(code).toContain('notifications');
  });

  it('cleans automation artifacts', () => {
    const code = generateStealthJs();
    expect(code).toContain('__playwright');
    expect(code).toContain('__puppeteer');
    expect(code).toContain("'cdc_'");
    expect(code).toContain("'__cdc_'");
  });

  it('filters CDP patterns from Error.stack', () => {
    const code = generateStealthJs();
    expect(code).toContain('puppeteer_evaluation_script');
    expect(code).toContain("'pptr:'");
    expect(code).toContain("'debugger://'");
  });

  it('neutralizes debugger statement traps', () => {
    const code = generateStealthJs();
    // Should patch Function constructor with new.target / Reflect.construct
    expect(code).toContain('_OrigFunction');
    expect(code).toContain('_PatchedFunction');
    expect(code).toContain('new.target');
    expect(code).toContain('Reflect.construct');
    // eval must retain its native identity for direct-eval semantics.
    expect(code).not.toContain('window.eval =');
    // Regex to strip debugger (lookbehind for statement boundaries)
    expect(code).toContain('_debuggerRe');
  });

  it('uses shared toString disguise via WeakMap', () => {
    const code = generateStealthJs();
    // Shared infrastructure at the top of the IIFE
    expect(code).toContain('_origToString');
    expect(code).toContain('WeakMap');
    expect(code).toContain('_disguised');
    expect(code).toContain('_disguise');
    // Should NOT have per-instance toString overrides on Function/eval
    // (they go through _disguise instead)
  });

  it('defends console method fingerprinting', () => {
    const code = generateStealthJs();
    expect(code).toContain('_consoleMethods');
    expect(code).toContain("'log'");
    expect(code).toContain("'warn'");
    expect(code).toContain("'error'");
    expect(code).toContain('[native code]');
    // Uses saved _origToString reference
    expect(code).toContain('_origToString.call');
  });

  it('defends window dimension detection', () => {
    const code = generateStealthJs();
    expect(code).toContain('outerWidth');
    expect(code).toContain('outerHeight');
    expect(code).toContain('innerWidth');
    expect(code).toContain('innerHeight');
  });

  it('filters Performance API entries', () => {
    const code = generateStealthJs();
    expect(code).toContain('getEntries');
    expect(code).toContain('getEntriesByType');
    expect(code).toContain('getEntriesByName');
    expect(code).toContain('_suspiciousPatterns');
  });

  it('cleans document $cdc_ properties', () => {
    const code = generateStealthJs();
    expect(code).toContain("'$cdc_'");
    expect(code).toContain("'$chrome_'");
  });

  it('patches iframe contentWindow.chrome consistency', () => {
    const code = generateStealthJs();
    expect(code).toContain('contentWindow');
    expect(code).toContain('HTMLIFrameElement');
  });

  it('uses non-enumerable guard flag on EventTarget.prototype', () => {
    const code = generateStealthJs();
    expect(code).toContain('EventTarget.prototype');
    expect(code).toContain("'__lsn'");
    expect(code).toContain('enumerable: false');
  });

  it('generates syntactically valid JavaScript', () => {
    const code = generateStealthJs();
    // new Function() parses the code without executing it in a real
    // browser context, catching syntax errors from template literal issues.
    expect(() => new Function(code)).not.toThrow();
  });
});

// Only the guard needs an EventTarget prototype to reach the dynamic-code
// patches. Other browser-specific patches are best-effort and may be skipped.
function createStealthRealm() {
  const context = createContext({});
  runInContext(`
    globalThis.window = globalThis;
    globalThis.EventTarget = class {};
    globalThis.navigator = {};
    globalThis.nativeEval = eval;
  `, context);
  runInContext(generateStealthJs(), context);
  return context;
}

describe('stealth eval semantics', () => {
  it('preserves native eval identity, including after repeated injection', () => {
    const context = createStealthRealm();
    expect(runInContext('eval === nativeEval', context)).toBe(true);
    expect(runInContext(generateStealthJs(), context)).toBe('skipped');
    expect(runInContext('eval === nativeEval', context)).toBe(true);
  });

  it('keeps webpack eval-devtool module bindings visible', () => {
    expect(runInContext(`
      (function(module, exports, __webpack_require__) {
        eval('module.exports = __webpack_require__.p + "image.png"');
        return module.exports;
      })({}, {}, { p: '/assets/' })
    `, createStealthRealm())).toBe('/assets/image.png');
  });

  it('reads and updates caller lexical bindings in strict mode', () => {
    expect(runInContext(`
      (function() {
        'use strict';
        let value = 41;
        eval('value += 1');
        return value;
      })()
    `, createStealthRealm())).toBe(42);
  });

  it('keeps non-strict eval declarations in the caller scope', () => {
    const context = createStealthRealm();
    expect(runInContext(`
      (function() {
        eval('var localValue = 7');
        return localValue;
      })()
    `, context)).toBe(7);
    expect(runInContext('typeof localValue', context)).toBe('undefined');
  });

  it('leaves indirect eval in the global scope', () => {
    expect(runInContext(`
      (function() {
        const callerOnly = 42;
        return (0, eval)('typeof callerOnly');
      })()
    `, createStealthRealm())).toBe('undefined');
  });

  it('returns non-string inputs unchanged', () => {
    expect(runInContext(`
      (function() {
        const value = {};
        return eval(value) === value;
      })()
    `, createStealthRealm())).toBe(true);
  });
});
