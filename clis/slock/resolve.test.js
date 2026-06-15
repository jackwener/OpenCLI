import { describe, it, expect } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { UUID_RE } from './resolve.js';
import { classifyThreadTarget } from './resolve.js';
import { classifyTarget } from './resolve.js';
import { assertMessageIdShape } from './resolve.js';
import { parseNonNegativeInteger, parsePositiveInteger } from './resolve.js';

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

describe('classifyTarget', () => {
  it('treats "#name" as a channel-name target', () => {
    expect(classifyTarget('#general')).toEqual({ kind: 'channel-name', name: 'general' });
  });

  it('treats a raw 36-char uuid as a channel-uuid target', () => {
    expect(classifyTarget('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      kind: 'channel-uuid',
      channelId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('treats "dm:@name" as a dm-name target', () => {
    expect(classifyTarget('dm:@alice')).toEqual({ kind: 'dm-name', name: 'alice' });
  });

  it('rejects "dm:not-a-uuid" with an ArgumentError-shaped throw', () => {
    expect(() => classifyTarget('dm:nope')).toThrow(/dm target must be/);
  });
});

describe('assertMessageIdShape', () => {
  it('returns the trimmed UUID when shape is valid', () => {
    const v = '  550e8400-e29b-41d4-a716-446655440000  ';
    expect(assertMessageIdShape(v)).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects short ids with a hint mentioning "NOT accepted"', () => {
    expect(() => assertMessageIdShape('8af3cbbb')).toThrow(/NOT accepted/);
  });

  // Typed-error contract: helpers throw ArgumentError directly so a future
  // caller that forgets the try/rewrap still surfaces a CliError subclass.
  it('throws ArgumentError (not raw Error) so unwrapped callers stay typed', () => {
    expect(() => assertMessageIdShape('8af3cbbb')).toThrow(ArgumentError);
    expect(() => classifyTarget('dm:')).toThrow(ArgumentError);
  });
});

describe('integer boundary helpers', () => {
  it('parsePositiveInteger accepts positive integers and defaults', () => {
    expect(parsePositiveInteger(undefined, '--limit', { defaultValue: 50 })).toBe(50);
    expect(parsePositiveInteger('3', '--limit')).toBe(3);
    expect(parsePositiveInteger(3, '--limit')).toBe(3);
  });

  it('parsePositiveInteger rejects zero, negatives, fractions, and max overflow', () => {
    expect(() => parsePositiveInteger(0, '--limit')).toThrow(ArgumentError);
    expect(() => parsePositiveInteger(-1, '--limit')).toThrow(ArgumentError);
    expect(() => parsePositiveInteger(1.5, '--limit')).toThrow(ArgumentError);
    expect(() => parsePositiveInteger('1e2', '--limit')).toThrow(ArgumentError);
    expect(() => parsePositiveInteger(' 3 ', '--limit')).toThrow(ArgumentError);
    expect(() => parsePositiveInteger(101, '--limit', { max: 100 })).toThrow(ArgumentError);
  });

  it('parseNonNegativeInteger accepts zero but rejects negatives and fractions', () => {
    expect(parseNonNegativeInteger(undefined, '--offset', { defaultValue: 0 })).toBe(0);
    expect(parseNonNegativeInteger('0', '--offset')).toBe(0);
    expect(parseNonNegativeInteger(2, '--offset')).toBe(2);
    expect(() => parseNonNegativeInteger(-1, '--offset')).toThrow(ArgumentError);
    expect(() => parseNonNegativeInteger(1.5, '--offset')).toThrow(ArgumentError);
    expect(() => parseNonNegativeInteger('1e2', '--offset')).toThrow(ArgumentError);
  });
});
