import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { resolveTargetJs } from './target-resolver.js';
import { buildFindJs, buildSemanticFindJs, isFindError, type FindError, type FindResult } from './find.js';

describe('isFindError', () => {
  it('narrows { error: ... } as FindError', () => {
    const payload: unknown = { error: { code: 'invalid_selector', message: 'x' } };
    expect(isFindError(payload)).toBe(true);
    if (isFindError(payload)) {
      const err: FindError = payload;
      expect(err.error.code).toBe('invalid_selector');
    }
  });

  it('rejects successful envelopes', () => {
    expect(isFindError({ matches_n: 0, entries: [] })).toBe(false);
    expect(isFindError(null)).toBe(false);
    expect(isFindError(undefined)).toBe(false);
    expect(isFindError('string')).toBe(false);
  });
});

describe('buildSemanticFindJs', () => {
  function runSemanticFind(html: string, opts: Parameters<typeof buildSemanticFindJs>[0]) {
    const dom = page(html);
    return {
      dom,
      result: dom.window.eval(buildSemanticFindJs(opts)),
    };
  }

  it('executes semantic role/name/testid matching and allocates a clickable ref', () => {
    const { dom, result } = runSemanticFind(
      '<button aria-label="Save expense" data-testid="save-button">Ignored copy</button>',
      { role: 'button', name: 'Save', testid: 'save' },
    );
    expect(result).toMatchObject({
      matches_n: 1,
      entries: [
        { nth: 0, ref: 1, tag: 'button', role: 'button', attrs: { 'aria-label': 'Save expense', 'data-testid': 'save-button' } },
      ],
    });
    const button = dom.window.document.querySelector('button')!;
    expect(button.getAttribute('data-opencli-ref')).toBe('1');
    expect((dom.window as any).__opencli_ref_identity['1']).toMatchObject({ tag: 'button', ariaLabel: 'Save expense' });
  });

  it('matches associated labels and placeholders for form controls', () => {
    const { result } = runSemanticFind(
      '<label for="category">Category</label><input id="category" placeholder="Expense category" value="Travel" />',
      { role: 'textbox', label: 'Category', name: 'Expense category' },
    );
    expect(result).toMatchObject({
      matches_n: 1,
      entries: [
        { nth: 0, ref: 1, tag: 'input', role: 'textbox' },
      ],
    });
  });
});

// Exercise the generated find → resolve contract rather than private helper names.
function page(html: string) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  pages.push(dom);
  return dom;
}
const pages: JSDOM[] = [];
afterEach(() => { for (const dom of pages.splice(0)) dom.window.close(); });

describe('CSS find and target resolution', () => {
  it('limits results, truncates text, filters attributes and allocates noncolliding refs', () => {
    const dom = page('<button data-opencli-ref="7">Old</button><button class="btn" id="save" style="color:red" onclick="x()">Save now</button><button class="btn">Cancel</button>');
    const result = dom.window.eval(buildFindJs('.btn', { limit: 1, textMax: 4 })) as FindResult;
    expect(result).toMatchObject({ matches_n: 2, entries: [{ ref: 8, nth: 0, tag: 'button', text: 'Save' }] });
    expect(result.entries[0].attrs).toEqual({ id: 'save', class: 'btn' });
    expect(dom.window.eval(resolveTargetJs('8'))).toMatchObject({ ok: true, match_level: 'exact' });
  });

  it.each([
    ['???', {}, 'invalid_selector'], ['.missing', {}, 'selector_not_found'],
    ['button', {}, 'selector_ambiguous'], ['button', { nth: 5 }, 'selector_nth_out_of_range'],
    ['"; window.injected = true; "', {}, 'invalid_selector'],
  ])('returns typed errors for %s (%j)', (selector, options, code) => {
    const dom = page('<button>A</button><button>B</button>');
    expect(dom.window.eval(resolveTargetJs(selector, options))).toMatchObject({ ok: false, code });
    expect((dom.window as any).injected).toBeUndefined();
  });

  it('supports nth, firstOnMulti and selectors outside the old prefix shortlist', () => {
    const dom = page('<button>A</button><button>B</button>');
    for (const [selector, options] of [['button', { nth: 1 }], ['button', { firstOnMulti: true }], [':root', {}]] as const) {
      expect(dom.window.eval(resolveTargetJs(selector, options))).toMatchObject({ ok: true, match_level: 'exact' });
    }
    expect(dom.window.eval(buildFindJs('???'))).toMatchObject({ error: { code: 'invalid_selector' } });
    expect(dom.window.eval(buildFindJs('.missing'))).toMatchObject({ error: { code: 'selector_not_found' } });
  });

  it('keeps strong identities stable and reidentifies a replaced node', () => {
    const dom = page('<button id="save">Save</button>');
    dom.window.eval(buildFindJs('button'));
    dom.window.document.querySelector('button')!.textContent = 'Enregistrer';
    expect(dom.window.eval(resolveTargetJs('1'))).toMatchObject({ ok: true, match_level: 'stable' });
    dom.window.document.body.innerHTML = '<button id="save">Save again</button>';
    expect(dom.window.eval(resolveTargetJs('1'))).toMatchObject({ ok: true, match_level: 'reidentified' });
    expect(dom.window.document.querySelector('button')!.getAttribute('data-opencli-ref')).toBe('1');
    expect(dom.window.eval(resolveTargetJs('1'))).toMatchObject({ ok: true, match_level: 'exact' });
  });

  it('rejects stale weak identities and ambiguous replacement candidates', () => {
    const dom = page('<button>Save</button><button aria-label="Delete">Delete</button>');
    dom.window.eval(buildFindJs('button'));
    dom.window.document.querySelector('button')!.textContent = 'Unrelated action';
    expect(dom.window.eval(resolveTargetJs('1'))).toMatchObject({ ok: false, code: 'stale_ref' });
    dom.window.document.body.innerHTML = '<button aria-label="Delete">Delete</button><button aria-label="Delete">Delete</button>';
    expect(dom.window.eval(resolveTargetJs('2'))).toMatchObject({ ok: false });
  });

  it('attaches compound control data and safely matches quoted criteria', () => {
    const dom = page('<input type="date" value="2026-10-16"><button aria-label="Save &quot;now&quot;">Save</button>');
    expect((dom.window.eval(buildFindJs('input')) as FindResult).entries[0].compound).toMatchObject({ control: 'date', current: '2026-10-16' });
    expect(dom.window.eval(buildSemanticFindJs({ name: 'Save "now"' }))).toMatchObject({ matches_n: 1 });
  });
});
