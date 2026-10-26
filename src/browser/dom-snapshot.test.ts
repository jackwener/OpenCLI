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

describe('table cell interactive refs (#2056)', () => {
  it('exposes a shared assignRef helper used by the main walk', () => {
    const js = generateSnapshotJs();
    expect(js).toContain('function assignRef(el)');
    // The normal interactive path routes through the shared helper, so table
    // cells and the main tree assign refs (and fingerprints) identically.
    expect(js).toContain('const idx = assignRef(el)');
  });

  it('assigns clickable refs to form controls inside table cells', () => {
    const js = generateSnapshotJs();
    // serializeTable scans each cell for interactive controls that were
    // previously dropped (button / input / select / textarea) ...
    expect(js).toContain("cell.querySelectorAll('button, input, select, textarea')");
    // ... skips disabled / non-interactive ones via the shared predicate ...
    expect(js).toContain('isInteractive(control)');
    // ... and gives each a real ref plus a [N] marker in the markdown cell.
    expect(js).toContain('assignRef(control)');
    expect(js).toContain('refMarks');
  });

  it('defers table-cell ref assignment until after the render gate', () => {
    const js = generateSnapshotJs();
    // Regression: assignRef mutates shared ref state. If serializeTable claimed
    // refs while building the grid and then bailed (grid.length < 2 / throw),
    // the caller falls through to the generic walk and re-assigns — orphaning
    // the first ref and desyncing refIdentity from the emitted [N] tokens.
    // The cell loop must only COLLECT controls; assignRef must run after the gate.
    const gate = js.indexOf('grid.length < 2');
    const tableAssign = js.indexOf('assignRef(control)');
    expect(gate).toBeGreaterThan(-1);
    expect(tableAssign).toBeGreaterThan(gate);
  });
});

describe('table cell interactive refs — behavior (#2056)', () => {
  // Evaluate the generated snapshot against a real (jsdom) DOM. jsdom returns
  // zero-size rects, which the engine prunes, so give every element a visible
  // in-viewport box and turn off the paint-order probe (elementFromPoint is
  // unreliable under jsdom).
  function runSnapshot(bodyHtml: string, opts: Record<string, unknown> = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
      url: 'https://example.com/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const { window } = dom;
    const box = { x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 24, width: 120, height: 24 };
    window.Element.prototype.getBoundingClientRect = function (): DOMRect { return box as unknown as DOMRect; };
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const output = window.eval(generateSnapshotJs({ paintOrderCheck: false, ...opts }));
    return { output, document: window.document };
  }

  it('gives a table-cell <button> a real ref and a [N] marker in the table', () => {
    const { output, document } = runSnapshot(`
      <table>
        <tr><th>Name</th><th>Action</th></tr>
        <tr><td>Alice</td><td><button>Details</button></td></tr>
      </table>`);
    const ref = document.querySelector('button')!.getAttribute('data-opencli-ref');
    expect(ref).toBeTruthy();
    expect(output).toContain('|table|');
    expect(output).toContain('[' + ref + ']');
  });

  it('keeps table-cell controls in INTERACTIVE_ONLY snapshots (no ancestor pruning)', () => {
    const { output, document } = runSnapshot(`
      <div><section>
        <table>
          <tr><th>Name</th><th>Action</th></tr>
          <tr><td>Alice</td><td><button>Follow up</button></td></tr>
        </table>
      </section></div>`, { interactiveOnly: true });
    const ref = document.querySelector('button')!.getAttribute('data-opencli-ref');
    expect(ref).toBeTruthy();
    // the table survives even though its only interactivity lives inside cells
    expect(output).toContain('|table|');
    expect(output).toContain('[' + ref + ']');
  });

  it('does not assign a ref to a disabled control in a cell', () => {
    const { document } = runSnapshot(`
      <table>
        <tr><th>Name</th><th>Action</th></tr>
        <tr><td>Alice</td><td><select disabled><option>x</option></select></td></tr>
      </table>`);
    expect(document.querySelector('select')!.hasAttribute('data-opencli-ref')).toBe(false);
  });
});
