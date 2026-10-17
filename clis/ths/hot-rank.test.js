import { describe, expect, it } from 'vitest';

import { __test__ } from './hot-rank.js';

describe('ths hot-rank command', () => {

  it('combines concept and popularity tags', () => {
    expect(__test__.tagsFromStock({
      tag: { concept_tag: ['AI'], popularity_tag: ['算力'] },
    })).toBe('AI,算力');
  });
});
