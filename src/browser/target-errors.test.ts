import { describe, expect, it } from 'vitest';
import { TargetError } from './target-errors.js';

describe('TargetError', () => {
  it('creates not_found error with code and hint', () => {
    const err = new TargetError({
      code: 'not_found',
      message: 'ref=99 not found in DOM',
      hint: 'Re-run `opencli browser state` to get a fresh snapshot.',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TargetError');
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('ref=99 not found in DOM');
    expect(err.hint).toContain('fresh snapshot');
    expect(err.candidates).toBeUndefined();
  });

  it('creates selector_ambiguous error with candidates + matches_n', () => {
    const err = new TargetError({
      code: 'selector_ambiguous',
      message: 'CSS selector ".btn" matched 3 elements',
      hint: 'Use a more specific selector, or pass --nth.',
      candidates: ['<button> "Login"', '<button> "Sign Up"', '<button> "Cancel"'],
      matches_n: 3,
    });

    expect(err.code).toBe('selector_ambiguous');
    expect(err.candidates).toHaveLength(3);
    expect(err.candidates![0]).toContain('Login');
    expect(err.matches_n).toBe(3);
  });

  it('creates invalid_selector error', () => {
    const err = new TargetError({
      code: 'invalid_selector',
      message: 'Invalid CSS selector: >>> (unexpected token)',
      hint: 'Check the selector syntax.',
    });

    expect(err.code).toBe('invalid_selector');
    expect(err.message).toContain('Invalid CSS selector');
  });

  it('creates selector_not_found error with matches_n=0', () => {
    const err = new TargetError({
      code: 'selector_not_found',
      message: 'CSS selector ".missing" matched 0 elements',
      hint: 'Check the page or use browser find.',
      matches_n: 0,
    });

    expect(err.code).toBe('selector_not_found');
    expect(err.matches_n).toBe(0);
  });

  it('creates selector_nth_out_of_range error', () => {
    const err = new TargetError({
      code: 'selector_nth_out_of_range',
      message: 'matched 3 elements, but --nth=5 is out of range',
      hint: 'Use --nth between 0 and 2.',
      matches_n: 3,
    });

    expect(err.code).toBe('selector_nth_out_of_range');
    expect(err.matches_n).toBe(3);
  });

  it('creates stale_ref error', () => {
    const err = new TargetError({
      code: 'stale_ref',
      message: 'ref=12 was <button>"Login" but now points to <div>"Header"',
      hint: 'Re-run `opencli browser state` to refresh.',
    });

    expect(err.code).toBe('stale_ref');
    expect(err.message).toContain('was <button>');
  });

  it('serializes to JSON for structured output', () => {
    const err = new TargetError({
      code: 'selector_ambiguous',
      message: 'matched 3',
      hint: 'be specific',
      candidates: ['a', 'b'],
      matches_n: 3,
    });

    const json = err.toJSON();
    expect(json).toEqual({
      code: 'selector_ambiguous',
      message: 'matched 3',
      hint: 'be specific',
      candidates: ['a', 'b'],
      matches_n: 3,
    });
  });

  it('omits candidates from JSON when not present', () => {
    const err = new TargetError({
      code: 'not_found',
      message: 'gone',
      hint: 'refresh',
    });

    const json = err.toJSON();
    expect(json).not.toHaveProperty('candidates');
  });
});
