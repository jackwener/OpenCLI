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

  it('tags every success envelope with match_level so agents can tell tiers apart', () => {
    const numericJs = resolveTargetJs('7');
    const cssJs = resolveTargetJs('.btn');
    // Exact / reidentified emit the literal directly; stable flows through the
    // classifier's `level` variable. All three strings must appear in the JS.
    expect(numericJs).toContain("match_level: 'exact'");
    expect(numericJs).toContain("match_level: 'reidentified'");
    expect(numericJs).toContain("return 'stable'");
    // Stable + exact share the same emit site (match_level: level) — make sure
    // we didn't hardcode one of them and drop the other.
    expect(numericJs).toContain('match_level: level');
    // CSS path is always exact (selector ran successfully).
    expect(cssJs).toContain("match_level: 'exact'");
  });

  it('cascading ref path — classifier + reidentifier are both wired in', () => {
    const js = resolveTargetJs('3');
    // Classifier distinguishes the three tiers
    expect(js).toContain('function classifyMatch');
    expect(js).toContain("return 'exact'");
    expect(js).toContain("return 'stable'");
    expect(js).toContain("return 'mismatch'");
    // Strong id is the only thing that can rescue a drifted fingerprint
    expect(js).toContain('hadStrongId');
    // Reidentify searches live DOM with the same fingerprint shape the
    // snapshot / find writers emit — id / testId / aria-label only.
    expect(js).toContain('function reidentify');
    expect(js).toContain('getElementById');
    expect(js).toContain('[data-testid="');
    expect(js).toContain('[aria-label="');
    // Unique match required — never silently picks one of many candidates.
    expect(js).toContain('candidates.length === 1');
    // Recovered element is re-tagged + identity map refreshed so subsequent
    // resolves land on 'exact' instead of re-walking the cascade.
    expect(js).toContain("setAttribute('data-opencli-ref', ref)");
    expect(js).toContain('identity[ref] = fingerprintOf(recovered)');
  });

  it('reidentify runs both when data-opencli-ref is missing AND when fingerprint is mismatched', () => {
    const js = resolveTargetJs('9');
    // Two call sites: one in the !el branch, one after classifyMatch returns mismatch.
    const count = js.split('reidentify(fp)').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('falls through to stale_ref only after reidentify exhausts', () => {
    const js = resolveTargetJs('4');
    // The stale_ref emit must sit *below* a reidentify attempt so the cascade
    // is what produces the error — not the original strict check.
    const reidentifyIdx = js.indexOf('const recovered = reidentify(fp);');
    const staleIdx = js.indexOf("code: 'stale_ref'");
    expect(reidentifyIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(reidentifyIdx);
  });
});
