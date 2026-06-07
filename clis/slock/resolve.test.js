import { describe, it, expect } from 'vitest';
import { UUID_RE } from './resolve.js';

describe('UUID_RE', () => {
  it('matches a v4-shaped uuid', () => {
    expect(UUID_RE.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects a short id (8 hex chars)', () => {
    expect(UUID_RE.test('8af3cbbb')).toBe(false);
  });
});
