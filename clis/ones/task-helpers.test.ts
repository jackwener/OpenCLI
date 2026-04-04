import { describe, expect, it } from 'vitest';
import { parsePeekLimit } from './task-helpers.js';

describe('parsePeekLimit', () => {
  it('returns the fallback when the input is not numeric', () => {
    expect(parsePeekLimit('abc', 30)).toBe(30);
  });

  it('clamps the input into the supported range', () => {
    expect(parsePeekLimit('0', 30)).toBe(30);
    expect(parsePeekLimit('999', 30)).toBe(500);
    expect(parsePeekLimit('42', 30)).toBe(42);
  });
});
