import { describe, expect, it } from 'vitest';
import { __test__ } from './chat.js';

describe('xianyu chat helpers', () => {
  it('builds goofish im urls from ids', () => {
    expect(__test__.buildChatUrl('1038951278192', '3650092411')).toBe(
      'https://www.goofish.com/im?itemId=1038951278192&peerUserId=3650092411',
    );
  });

  it('normalizes numeric ids', () => {
    expect(__test__.normalizeNumericId('1038951278192', 'item_id', '1038951278192')).toBe('1038951278192');
    expect(__test__.normalizeNumericId(3650092411, 'user_id', '3650092411')).toBe('3650092411');
  });

  it('rejects non-numeric ids', () => {
    expect(() => __test__.normalizeNumericId('abc', 'item_id', '1038951278192')).toThrow();
    expect(() => __test__.normalizeNumericId('3650092411x', 'user_id', '3650092411')).toThrow();
  });
});
