/**
 * Tests for dom-snapshot.ts: DOM snapshot engine.
 *
 * Since the engine generates JavaScript strings for in-page evaluation,
 * these tests validate:
 * 1. The generated code is syntactically valid JS
 * 2. Options are correctly embedded
 * 3. The output structure matches expected format
 * 4. All features are present (Shadow DOM, iframe, table, diff, etc.)
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';

describe('generateSnapshotJs', () => {

  it('clamps maxDepth between 1 and 200', () => {
    expect(generateSnapshotJs({ maxDepth: -5 })).toContain('MAX_DEPTH = 1');
    expect(generateSnapshotJs({ maxDepth: 999 })).toContain('MAX_DEPTH = 200');
    expect(generateSnapshotJs({ maxDepth: 75 })).toContain('MAX_DEPTH = 75');
  });

});

const pages: JSDOM[] = [];
afterEach(() => { for (const dom of pages.splice(0)) dom.window.close(); });
function page(html: string) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  pages.push(dom);
  return dom;
}

describe('scroll and form scripts', () => {
  it.each(['data-opencli-ref', 'data-ref'])('scrolls the selected %s element and reports missing refs', (attribute) => {
    const dom = page(`<button ${attribute}="7">Target</button>`);
    const scroll = vi.fn();
    dom.window.document.querySelector('button')!.scrollIntoView = scroll;
    expect(dom.window.eval(scrollToRefJs('7'))).toEqual({ scrolled: true, tag: 'button', text: 'Target' });
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    expect(() => dom.window.eval(scrollToRefJs('missing'))).toThrow('Element not found');
  });

  it('extracts labeled form and orphan fields while masking passwords', () => {
    const dom = page(`<form id="login">
      <label for="user">User</label><input id="user" value="Alice" data-opencli-ref="3" required>
      <input type="password" value="secret"><input type="checkbox" checked aria-label="Remember">
      <input type="hidden" value="private"><select><option selected>Travel</option></select>
    </form><textarea placeholder="Notes">Hello</textarea>`);
    const state = dom.window.eval(getFormStateJs()) as { forms: unknown[]; orphanFields: unknown[] };
    expect(state.forms[0]).toMatchObject({ id: 'login', fields: [
      { label: 'User', value: 'Alice', ref: '3', required: true },
      { type: 'password', value: '••••' }, { label: 'Remember', value: true },
      { tag: 'select', value: 'Travel' },
    ] });
    expect(state.orphanFields).toMatchObject([{ label: 'Notes', value: 'Hello' }]);
    expect(JSON.stringify(state)).not.toMatch(/secret|private/);
  });

  it('emits search controls and compound information in a snapshot', () => {
    const dom = page('<label><input type="search" placeholder="Search"></label><input type="date" value="2026-10-16"><script>private_script</script>');
    const snapshot = dom.window.eval(generateSnapshotJs());
    expect(snapshot).toContain('Search');
    expect(snapshot).toContain('compounds (');
    expect(snapshot).toContain('YYYY-MM-DD');
    expect(snapshot).not.toContain('private_script');
    expect(dom.window.document.querySelector('input[type="search"]')!.hasAttribute('data-opencli-ref')).toBe(true);
  });
});
