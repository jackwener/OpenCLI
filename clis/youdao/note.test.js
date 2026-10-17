import { describe, it, expect } from 'vitest';

const { __test__ } = await import('./note.js');
const command = __test__.command;

describe('youdao note', () => {

  it('accepts canonical youdao share URLs', () => {
    expect(__test__.normalizeShareUrl('https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/')).toBe('https://share.note.youdao.com/ynoteshare/index.html?id=abc&type=note#/');
    expect(__test__.normalizeShareUrl('https://note.youdao.cn/ynoteshare/index.html?id=abc')).toBe('https://note.youdao.cn/ynoteshare/index.html?id=abc');
  });

  it('keeps the full-content React store extractor contract in source', () => {
    const js = __test__.buildExtractorJs();
    expect(js).toContain('store.content');
    expect(js).toContain('contentData.content');
    expect(js).toContain('__reactContainer$');
    expect(js).toContain('walkText');
  });
});
