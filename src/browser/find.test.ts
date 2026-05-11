import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildFindJs, buildSemanticFindJs, FIND_ATTR_WHITELIST, isFindError, type FindError } from './find.js';

/**
 * These tests validate the shape and options of the generated JS string
 * (no DOM available in the default vitest unit env). Runtime behavior of
 * the generated JS against a real DOM is covered by the browser e2e suite.
 */

describe('buildFindJs', () => {
  it('produces syntactically valid JS that can be parsed', () => {
    expect(() => new Function(`return (${buildFindJs('.btn')});`)).not.toThrow();
  });

  it('embeds the selector via JSON.stringify (injection-safe)', () => {
    const js = buildFindJs('[data-x="a\"b"]');
    // Unescaped literal break-out must not appear
    expect(js).not.toContain('[data-x="a"b"]');
    // The JSON-encoded form (with escaped quotes) should
    expect(js).toContain(JSON.stringify('[data-x="a\"b"]'));
  });

  it('emits invalid_selector + selector_not_found branches', () => {
    const js = buildFindJs('.btn');
    expect(js).toContain("code: 'invalid_selector'");
    expect(js).toContain("code: 'selector_not_found'");
  });

  it('emits matches_n + entries + per-entry shape', () => {
    const js = buildFindJs('.btn');
    expect(js).toContain('matches_n: matches.length');
    expect(js).toContain('entries.push(');
    // Per-entry keys reviewers signed off on: nth, ref, tag, role, text, attrs, visible
    expect(js).toContain('nth: i');
    expect(js).toContain('ref: refNum');
    expect(js).toContain('tag: el.tagName.toLowerCase()');
    expect(js).toContain("el.getAttribute('role')");
    expect(js).toContain('visible: isVisible(el)');
  });

  it('allocates fresh refs for untagged matches (write attribute + identity map)', () => {
    const js = buildFindJs('.btn');
    // On the just-annotated branch we must flip the attribute on the element
    // so downstream `browser click <ref>` works off the find output.
    expect(js).toContain("el.setAttribute('data-opencli-ref'");
    // The fingerprint must also land in the shared identity map so the
    // target resolver's stale-ref check has data to verify against.
    expect(js).toContain('__opencli_ref_identity');
    expect(js).toContain("identity['' + refNum] = fingerprintOf(el)");
    // Allocation walks both the identity map and any existing data-opencli-ref
    // annotations — guards against collisions after a soft nav.
    expect(js).toContain("document.querySelectorAll('[data-opencli-ref]')");
  });

  it('fingerprint shape matches the snapshot / resolver contract', () => {
    const js = buildFindJs('.btn');
    // The six fields resolveTargetJs verifies in its stale_ref check.
    for (const field of ['tag:', 'role:', 'text:', 'ariaLabel:', 'id:', 'testId:']) {
      expect(js).toContain(field);
    }
  });

  it('embeds defaults for limit and textMax', () => {
    const js = buildFindJs('.btn');
    expect(js).toContain('LIMIT = 50');
    expect(js).toContain('TEXT_MAX = 120');
  });

  it('overrides limit and textMax when requested', () => {
    const js = buildFindJs('.btn', { limit: 3, textMax: 20 });
    expect(js).toContain('LIMIT = 3');
    expect(js).toContain('TEXT_MAX = 20');
  });

  it('embeds the attribute whitelist verbatim (no style/onclick leaking)', () => {
    const js = buildFindJs('.btn');
    // Whitelist fields appear inside the generated JS
    for (const key of FIND_ATTR_WHITELIST) {
      expect(js).toContain(`"${key}"`);
    }
    // Sensitive / high-noise attrs must stay out of the whitelist
    expect(FIND_ATTR_WHITELIST).not.toContain('style' as never);
    expect(FIND_ATTR_WHITELIST).not.toContain('onclick' as never);
    expect(FIND_ATTR_WHITELIST).not.toContain('onload' as never);
  });

  it('inlines compoundInfoOf and attaches compound field per entry', () => {
    const js = buildFindJs('input, select');
    // Helper definition is inlined so each matched element can be classified.
    expect(js).toContain('function compoundInfoOf(el)');
    // The emitted entry opts in only when compound data is present — no noisy
    // compound: null on every non-form element.
    expect(js).toContain('const compound = compoundInfoOf(el);');
    expect(js).toContain('if (compound) entry.compound = compound;');
    // Spot-check all three compound families are covered in the inlined helper.
    expect(js).toContain("'YYYY-MM-DD'");
    expect(js).toContain("control: 'file'");
    expect(js).toContain("control: 'select'");
  });

  it('keeps the whitelist small and explicit (guardrail against silent expansion)', () => {
    expect(FIND_ATTR_WHITELIST).toEqual([
      'id',
      'class',
      'name',
      'type',
      'placeholder',
      'aria-label',
      'title',
      'href',
      'value',
      'role',
      'data-testid',
    ]);
  });
});

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
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    return {
      dom,
      result: dom.window.eval(buildSemanticFindJs(opts)),
    };
  }

  it('produces syntactically valid JS and embeds semantic criteria safely', () => {
    const js = buildSemanticFindJs({ role: 'button', name: 'Save "now"', testid: 'submit' });
    expect(() => new Function(`return (${js});`)).not.toThrow();
    expect(js).toContain(JSON.stringify({
      role: 'button',
      name: 'Save "now"',
      label: '',
      text: '',
      testid: 'submit',
    }));
  });

  it('matches native roles, accessible name, labels, text, and test ids', () => {
    const js = buildSemanticFindJs({ role: 'button', name: 'Save', label: 'Category', text: 'Travel', testid: 'category' });
    expect(js).toContain('function nativeRole(el)');
    expect(js).toContain('function accessibleName(el)');
    expect(js).toContain('function labelText(el)');
    expect(js).toContain('CRITERIA.role');
    expect(js).toContain('CRITERIA.name');
    expect(js).toContain('CRITERIA.label');
    expect(js).toContain('CRITERIA.text');
    expect(js).toContain('CRITERIA.testid');
  });

  it('allocates refs exactly like CSS find so downstream actions can click them', () => {
    const js = buildSemanticFindJs({ role: 'button', name: 'Save' });
    expect(js).toContain("el.setAttribute('data-opencli-ref'");
    expect(js).toContain('__opencli_ref_identity');
    expect(js).toContain("identity['' + refNum] = fingerprintOf(el)");
    expect(js).toContain("document.querySelectorAll('[data-opencli-ref]')");
  });

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
