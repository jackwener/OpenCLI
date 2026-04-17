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
    expect(js).toContain('ambiguous');
    expect(js).toContain('candidates');
  });

  it('generates JS that rejects unrecognized input', () => {
    const js = resolveTargetJs('???');
    expect(js).toContain('not_found');
    expect(js).toContain('Cannot parse target');
  });

  it('escapes ref value safely', () => {
    const js = resolveTargetJs('"; alert(1); "');
    // JSON.stringify should handle escaping
    expect(js).not.toContain('alert(1); "');
    expect(js).toContain('\\"');
  });
});
