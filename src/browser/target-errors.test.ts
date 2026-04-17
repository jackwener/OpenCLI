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

  it('creates ambiguous error with candidates', () => {
    const err = new TargetError({
      code: 'ambiguous',
      message: 'CSS selector ".btn" matched 3 elements',
      hint: 'Use a more specific selector.',
      candidates: ['<button> "Login"', '<button> "Sign Up"', '<button> "Cancel"'],
    });

    expect(err.code).toBe('ambiguous');
    expect(err.candidates).toHaveLength(3);
    expect(err.candidates![0]).toContain('Login');
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
      code: 'ambiguous',
      message: 'matched 3',
      hint: 'be specific',
      candidates: ['a', 'b'],
    });

    const json = err.toJSON();
    expect(json).toEqual({
      code: 'ambiguous',
      message: 'matched 3',
      hint: 'be specific',
      candidates: ['a', 'b'],
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
