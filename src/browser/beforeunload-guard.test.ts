import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { generateBeforeUnloadGuardJs } from './beforeunload-guard.js';

function createWindow(): JSDOM['window'] {
  return new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
}

describe('beforeunload guard', () => {
  it('stops a handler the page registers after the guard', () => {
    const window = createWindow();
    window.eval(generateBeforeUnloadGuardJs());
    let handled = false;
    window.addEventListener('beforeunload', () => { handled = true; });

    window.dispatchEvent(new window.Event('beforeunload', { cancelable: true }));

    expect(handled).toBe(false);
  });

  it('stops an onbeforeunload assigned after the guard', () => {
    const window = createWindow();
    window.eval(generateBeforeUnloadGuardJs());
    let handled = false;
    window.onbeforeunload = () => {
      handled = true;
      return 'stay';
    };

    window.dispatchEvent(new window.Event('beforeunload', { cancelable: true }));

    expect(handled).toBe(false);
  });

  it('installs once per document, without an enumerable window flag', () => {
    const window = createWindow();

    expect(window.eval(generateBeforeUnloadGuardJs())).toBe('installed');
    expect(window.eval(generateBeforeUnloadGuardJs())).toBe('skipped');
    expect(Object.keys(window)).not.toContain('__lsnUnload');
  });

  it('leaves other events alone', () => {
    const window = createWindow();
    window.eval(generateBeforeUnloadGuardJs());
    let seen = false;
    window.addEventListener('unload', () => { seen = true; });

    window.dispatchEvent(new window.Event('unload'));

    expect(seen).toBe(true);
  });

  it('stays in step with the copy the extension injects', () => {
    const extensionSource = readFileSync(
      new URL('../../extension/src/cdp.ts', import.meta.url),
      'utf-8',
    );
    const extensionGuard = /const BEFORE_UNLOAD_GUARD_JS = `\n([\s\S]*?)\n`;/.exec(extensionSource)?.[1] ?? '';
    // The extension cannot import from this package, so it carries the script
    // inline; only the test-facing return values differ.
    const normalize = (source: string) => source
      .replace(/return\s*(?:'installed'|'skipped')?\s*;/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(normalize(extensionGuard)).toBe(normalize(generateBeforeUnloadGuardJs()));
  });

  it('keeps the calls that a post-load injection cannot substitute for', () => {
    const source = generateBeforeUnloadGuardJs();

    // jsdom dispatches at-target listeners in capture-then-bubble order while
    // Blink uses registration order, so the ordering that matters in Chrome is
    // pinned on the source instead of on a jsdom dispatch.
    expect(source).toContain('stopImmediatePropagation');
    expect(source).toContain('window.onbeforeunload = null');
  });
});
