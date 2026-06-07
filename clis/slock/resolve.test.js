import { describe, it, expect } from 'vitest';
import { UUID_RE } from './resolve.js';
import { classifyThreadTarget } from './resolve.js';

describe('UUID_RE', () => {
  it('matches a v4-shaped uuid', () => {
    expect(UUID_RE.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects a short id (8 hex chars)', () => {
    expect(UUID_RE.test('8af3cbbb')).toBe(false);
  });
});

describe('classifyThreadTarget', () => {
  it('parses "#name:short" into parent + short msg id', () => {
    expect(classifyThreadTarget('#general:8af3cbbb')).toEqual({
      parentTarget: '#general',
      parentMsgId: '8af3cbbb',
    });
  });

  it('parses "uuid:short" with raw channel uuid as parent', () => {
    expect(classifyThreadTarget('550e8400-e29b-41d4-a716-446655440000:8af3cbbb')).toEqual({
      parentTarget: '550e8400-e29b-41d4-a716-446655440000',
      parentMsgId: '8af3cbbb',
    });
  });

  it('returns null when the suffix is shorter than 6 chars (not a thread shape)', () => {
    expect(classifyThreadTarget('#general:abc')).toBeNull();
  });
});
