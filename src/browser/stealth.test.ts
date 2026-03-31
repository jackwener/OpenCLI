import { describe, it, expect } from 'vitest';
import { generateStealthJs } from './stealth.js';

/**
 * Tests for the stealth anti-detection module.
 *
 * We test the generated JS string for expected content and structure.
 * Evaluating in Node is fragile because stealth patches target browser
 * globals (navigator, Performance, HTMLIFrameElement) that don't exist
 * or behave differently in Node. Instead we verify the code string
 * contains the right patches and is syntactically valid.
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
    // Should patch eval
    expect(code).toContain('_origEval');
    expect(code).toContain('_patchedEval');
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
