import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { getRegistry } from '../../registry.js';
import './comments.js';

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
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

describe('xiaohongshu comments', () => {
  const command = getRegistry().get('xiaohongshu/comments');

  it('returns ranked comment rows', async () => {
    const page = createPageMock({
      loginWall: false,
      results: [
        { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01' },
        { author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02' },
      ],
    });

    const result = (await command!.func!(page, { 'note-id': '69aadbcb000000002202f131', limit: 5 })) as any[];

    expect((page.goto as any).mock.calls[0][0]).toContain('/explore/69aadbcb000000002202f131');
    expect(result).toEqual([
      { rank: 1, author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01' },
      { rank: 2, author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02' },
    ]);
    expect(result[0]).not.toHaveProperty('loginWall');
  });

  it('strips /explore/ prefix from full URL input', async () => {
    const page = createPageMock({
      loginWall: false,
      results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01' }],
    });

    await command!.func!(page, {
      'note-id': 'https://www.xiaohongshu.com/explore/69aadbcb000000002202f131',
      limit: 5,
    });

    expect((page.goto as any).mock.calls[0][0]).toContain('/explore/69aadbcb000000002202f131');
  });

  it('throws AuthRequiredError when login wall is detected', async () => {
    const page = createPageMock({ loginWall: true, results: [] });

    await expect(command!.func!(page, { 'note-id': 'abc123', limit: 5 })).rejects.toThrow(
      'Note comments require login',
    );
  });

  it('returns empty array when no comments are found', async () => {
    const page = createPageMock({ loginWall: false, results: [] });

    await expect(command!.func!(page, { 'note-id': 'abc123', limit: 5 })).resolves.toEqual([]);
  });

  it('respects the limit', async () => {
    const manyComments = Array.from({ length: 10 }, (_, i) => ({
      author: `User${i}`,
      text: `Comment ${i}`,
      likes: i,
      time: '2024-01-01',
    }));
    const page = createPageMock({ loginWall: false, results: manyComments });

    const result = (await command!.func!(page, { 'note-id': 'abc123', limit: 3 })) as any[];
    expect(result).toHaveLength(3);
    expect(result[0].rank).toBe(1);
    expect(result[2].rank).toBe(3);
  });
});
