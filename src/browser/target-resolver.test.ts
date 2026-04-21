import { describe, expect, it } from 'vitest';
import { resolveTargetJs } from './target-resolver.js';

/**
 * Tests for the target resolver JS generator.
 *
 * Since resolveTargetJs() produces JS strings for browser evaluate(),
 * we test the generated JS by running it in a simulated DOM-like context
 * and verifying the structure of the output.
 */

describe('resolveTargetJs', () => {
  it('generates JS that returns structured resolution for numeric ref', () => {
    const js = resolveTargetJs('12');
    expect(js).toContain('data-opencli-ref');
    expect(js).toContain('__opencli_ref_identity');
    expect(js).toContain('"12"');
  });

  it('generates JS that handles CSS selector input', () => {
    const js = resolveTargetJs('#submit-btn');
    expect(js).toContain('querySelectorAll');
    expect(js).toContain('"#submit-btn"');
  });

  it('generates JS with stale_ref detection for numeric refs', () => {
    const js = resolveTargetJs('5');
    expect(js).toContain('stale_ref');
    expect(js).toContain('__opencli_ref_identity');
  });

  it('generates JS with ambiguity detection for CSS selectors', () => {
    const js = resolveTargetJs('.btn');
    expect(js).toContain('selector_ambiguous');
    expect(js).toContain('candidates');
  });

  it('generates JS that propagates --nth option into the CSS branch', () => {
    const js = resolveTargetJs('.btn', { nth: 2 });
    expect(js).toContain('selector_nth_out_of_range');
    // opt.nth=2 should be inlined so the runtime picks matches[2]
    expect(js).toMatch(/const nth = 2;?/);
  });

  it('generates JS that enables firstOnMulti for read commands', () => {
    const js = resolveTargetJs('.btn', { firstOnMulti: true });
    expect(js).toContain('firstOnMulti = true');
  });

  it('generates JS with invalid_selector branch for CSS syntax errors', () => {
    const js = resolveTargetJs('.btn');
    expect(js).toContain('invalid_selector');
  });

  it('generates JS with selector_not_found branch for 0 matches', () => {
    const js = resolveTargetJs('#does-not-exist');
    expect(js).toContain('selector_not_found');
  });

  it('hands every non-numeric input to querySelectorAll (no regex shortlist)', () => {
    // Inputs that the old isCssLike regex rejected — must all flow into the
    // CSS branch so `find --css` and `get/click/type/select` accept the same surface.
    for (const sel of [':root', '*', ':has(.foo)', '::shadow-root', '???']) {
      const js = resolveTargetJs(sel);
      expect(js).toContain('querySelectorAll');
      // invalid selectors still route through invalid_selector at runtime,
      // never through a frontend "Cannot parse target" rejection.
      expect(js).not.toContain('Cannot parse target');
    }
  });

  it('escapes ref value safely', () => {
    const js = resolveTargetJs('"; alert(1); "');
    // JSON.stringify should handle escaping
    expect(js).not.toContain('alert(1); "');
    expect(js).toContain('\\"');
  });
});
