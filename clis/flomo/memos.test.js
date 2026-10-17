import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const { __test__ } = await import('./memos.js');
const { command, normalizeMemo, parsePositiveIntArg, parseSinceArg, parseSlugArg } = __test__;

describe('flomo memos argument validation', () => {
  it('rejects invalid limits instead of silently clamping', () => {
    expect(() => parsePositiveIntArg('0', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('201', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('10.5', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(() => parsePositiveIntArg('abc', 'limit', 20, 200)).toThrow(ArgumentError);
    expect(parsePositiveIntArg(undefined, 'limit', 20, 200)).toBe(20);
    expect(parsePositiveIntArg('200', 'limit', 20, 200)).toBe(200);
  });

  it('rejects invalid since and slug arguments', () => {
    expect(parseSinceArg(undefined)).toBe(0);
    expect(parseSinceArg('1735689600')).toBe(1735689600);
    expect(() => parseSinceArg('-1')).toThrow(ArgumentError);
    expect(() => parseSinceArg('1.5')).toThrow(ArgumentError);
    expect(parseSlugArg(undefined)).toBe('');
    expect(parseSlugArg('abc_DEF-123')).toBe('abc_DEF-123');
    expect(() => parseSlugArg('bad/slash')).toThrow(ArgumentError);
    expect(() => parseSlugArg('bad space')).toThrow(ArgumentError);
  });
});

describe('flomo memo normalization', () => {
  it('emits string-safe id/url fields and normalizes tags/images', () => {
    expect(normalizeMemo({
      slug: 'memo_12345678901234567890',
      content: ' <p>Hello</p> ',
      tags: [{ name: 'work' }, 'idea'],
      files: [{ thumbnail_url: 'https://img/thumb.jpg' }, { url: 'https://img/full.jpg' }],
      created_at: '2026-01-01T00:00:00+08:00',
      updated_at: '2026-01-02T00:00:00+08:00',
    })).toEqual({
      id: 'memo_12345678901234567890',
      url: 'https://v.flomoapp.com/mine/?memo_id=memo_12345678901234567890',
      content: '<p>Hello</p>',
      slug: 'memo_12345678901234567890',
      tags: 'work, idea',
      images: 'https://img/thumb.jpg | https://img/full.jpg',
      created_at: '2026-01-01T00:00:00+08:00',
      updated_at: '2026-01-02T00:00:00+08:00',
    });
  });

  it('fails typed on malformed memo entries', () => {
    expect(() => normalizeMemo(null)).toThrow(CommandExecutionError);
    expect(() => normalizeMemo({ content: 'missing slug' })).toThrow(CommandExecutionError);
  });
});
