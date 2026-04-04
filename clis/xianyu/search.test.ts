import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('xianyu search helpers', () => {
  it('normalizes limit into supported range', () => {
    expect(__test__.normalizeLimit(undefined)).toBe(20);
    expect(__test__.normalizeLimit(0)).toBe(1);
    expect(__test__.normalizeLimit(3.8)).toBe(3);
    expect(__test__.normalizeLimit(999)).toBe(__test__.MAX_LIMIT);
  });

  it('builds search URLs with encoded queries', () => {
    expect(__test__.buildSearchUrl('笔记本电脑')).toBe(
      'https://www.goofish.com/search?q=%E7%AC%94%E8%AE%B0%E6%9C%AC%E7%94%B5%E8%84%91',
    );
  });

  it('extracts item ids from detail URLs', () => {
    expect(__test__.itemIdFromUrl('https://www.goofish.com/item?id=954988715389&categoryId=126854525')).toBe('954988715389');
    expect(__test__.itemIdFromUrl('https://www.goofish.com/search?q=test')).toBe('');
  });
});
