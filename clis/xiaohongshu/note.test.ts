import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';
import { getRegistry } from '@jackwener/opencli/registry';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';
import './note.js';

function createPageMock(evaluateResult: any): IPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  };
}

describe('parseNoteId', () => {
  it('extracts ID from /explore/ URL', () => {
    expect(parseNoteId('https://www.xiaohongshu.com/explore/69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
  });

  it('extracts ID from /search_result/ URL with query params', () => {
    expect(parseNoteId('https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc')).toBe('69c131c9000000002800be4c');
  });

  it('extracts ID from /note/ URL', () => {
    expect(parseNoteId('https://www.xiaohongshu.com/note/69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
  });

  it('returns raw string when no URL pattern matches', () => {
    expect(parseNoteId('69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
  });

  it('trims whitespace', () => {
    expect(parseNoteId('  69c131c9000000002800be4c  ')).toBe('69c131c9000000002800be4c');
  });
});

describe('buildNoteUrl', () => {
  it('returns full URL as-is when given https URL', () => {
    const url = 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok';
    expect(buildNoteUrl(url)).toBe(url);
  });

  it('constructs /search_result/ URL for bare note ID', () => {
    expect(buildNoteUrl('abc123')).toBe('https://www.xiaohongshu.com/search_result/abc123');
  });
});

describe('xiaohongshu note', () => {
  const command = getRegistry().get('xiaohongshu/note');

  it('is registered', () => {
    expect(command).toBeDefined();
    expect(command!.func).toBeTypeOf('function');
  });

  it('returns note content as field/value rows', async () => {
    const page = createPageMock({
      loginWall: false,
      notFound: false,
      title: '尚界Z7实车体验',
      desc: '今天去看了实车，外观很帅',
      author: '小红薯用户',
      likes: '257',
      collects: '98',
      comments: '45',
      tags: ['#尚界Z7', '#鸿蒙智行'],
    });

    const result = (await command!.func!(page, { 'note-id': '69c131c9000000002800be4c' })) as any[];

    expect((page.goto as any).mock.calls[0][0]).toContain('/search_result/69c131c9000000002800be4c');
    expect(result).toEqual([
      { field: 'title', value: '尚界Z7实车体验' },
      { field: 'author', value: '小红薯用户' },
      { field: 'content', value: '今天去看了实车，外观很帅' },
      { field: 'likes', value: '257' },
      { field: 'collects', value: '98' },
      { field: 'comments', value: '45' },
      { field: 'tags', value: '#尚界Z7, #鸿蒙智行' },
    ]);
  });

  it('parses note ID from full /explore/ URL', async () => {
    const page = createPageMock({
      loginWall: false, notFound: false,
      title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
    });

    await command!.func!(page, {
      'note-id': 'https://www.xiaohongshu.com/explore/69c131c9000000002800be4c?xsec_token=abc',
    });

    expect((page.goto as any).mock.calls[0][0]).toContain('/explore/69c131c9000000002800be4c');
  });

  it('preserves full search_result URL with xsec_token for navigation', async () => {
    const page = createPageMock({
      loginWall: false, notFound: false,
      title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
    });

    const fullUrl = 'https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc';
    await command!.func!(page, { 'note-id': fullUrl });

    // Should navigate to the full URL as-is, not strip the token
    expect((page.goto as any).mock.calls[0][0]).toBe(fullUrl);
  });

  it('throws AuthRequiredError on login wall', async () => {
    const page = createPageMock({ loginWall: true, notFound: false });

    await expect(command!.func!(page, { 'note-id': 'abc123' })).rejects.toThrow('Note content requires login');
  });

  it('throws EmptyResultError when note is not found', async () => {
    const page = createPageMock({ loginWall: false, notFound: true });

    await expect(command!.func!(page, { 'note-id': 'abc123' })).rejects.toThrow('returned no data');
  });

  it('throws an empty-result error when the note page renders as an empty shell', async () => {
    const page = createPageMock({
      loginWall: false,
      notFound: false,
      title: '',
      desc: '',
      author: '',
      likes: '',
      collects: '',
      comments: '',
      tags: [],
    });

    try {
      await command!.func!(page, { 'note-id': '69ca3927000000001a020fd5' });
      throw new Error('expected xiaohongshu note to fail on an empty shell page');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'EMPTY_RESULT',
        hint: expect.stringContaining('loaded without visible content'),
      });
    }
  });

  it('keeps the empty-shell hint generic when the user already passed a full URL', async () => {
    const page = createPageMock({
      loginWall: false,
      notFound: false,
      title: '',
      desc: '',
      author: '',
      likes: '',
      collects: '',
      comments: '',
      tags: [],
    });

    try {
      await command!.func!(page, {
        'note-id': 'https://www.xiaohongshu.com/search_result/69ca3927000000001a020fd5?xsec_token=abc',
      });
      throw new Error('expected xiaohongshu note to fail on an empty shell page');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'EMPTY_RESULT',
        hint: expect.stringContaining('loaded without visible content'),
      });
      expect((error as { hint?: string }).hint).not.toContain('bare note ID');
    }
  });

  it('normalizes placeholder text to 0 for zero-count metrics', async () => {
    const page = createPageMock({
      loginWall: false, notFound: false,
      title: 'New note', desc: 'Just posted', author: 'Author',
      likes: '赞', collects: '收藏', comments: '评论', tags: [],
    });

    const result = (await command!.func!(page, { 'note-id': 'abc123' })) as any[];
    expect(result.find((r: any) => r.field === 'likes')!.value).toBe('0');
    expect(result.find((r: any) => r.field === 'collects')!.value).toBe('0');
    expect(result.find((r: any) => r.field === 'comments')!.value).toBe('0');
  });

  it('omits tags row when no tags present', async () => {
    const page = createPageMock({
      loginWall: false, notFound: false,
      title: 'No tags', desc: 'Content', author: 'Author',
      likes: '1', collects: '2', comments: '3', tags: [],
    });

    const result = (await command!.func!(page, { 'note-id': 'abc123' })) as any[];
    expect(result.find((r: any) => r.field === 'tags')).toBeUndefined();
    expect(result).toHaveLength(6);
  });
});
