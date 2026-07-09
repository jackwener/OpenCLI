import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './novel-search.js';

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novel-search');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv novel-search', () => {
  it('throws AuthRequiredError on 401', async () => {
    const page = createPageMock([{ __httpError: 401 }]);
    await expect(cmd.func(page, { query: 'ファンタジー', limit: 5 })).rejects.toThrow(AuthRequiredError);
  });

  it('throws generic error on non-auth HTTP failure', async () => {
    const page = createPageMock([{ __httpError: 500 }]);
    await expect(cmd.func(page, { query: 'test', limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('returns ranked novel results with stable fields', async () => {
    const page = createPageMock([
      {
        body: {
          novel: {
            data: [
              {
                id: '10588915',
                title: '星之观测手记',
                userName: '示例作者',
                userId: '37119297',
                wordCount: 75463,
                textCount: 135811,
                bookmarkCount: 2829,
                tags: ['一般', '中文', 'ファンタジー'],
                createDate: '2019-01-06T21:48:16+09:00',
              },
              {
                id: '10588869',
                title: '雨夜档案室',
                userName: '示例作者',
                userId: '37119297',
                wordCount: 6399,
                textCount: 11762,
                bookmarkCount: 1238,
                tags: ['一般', '冒険'],
                createDate: '2019-01-06T21:43:14+09:00',
              },
            ],
          },
        },
      },
    ]);

    const result = await cmd.func(page, { query: 'ファンタジー', limit: 10 });
    expect(result).toEqual([
      {
        rank: 1,
        title: '星之观测手记',
        author: '示例作者',
        user_id: '37119297',
        novel_id: '10588915',
        words: 75463,
        characters: 135811,
        bookmarks: 2829,
        tags: '一般, 中文, ファンタジー',
        created: '2019-01-06',
        url: 'https://www.pixiv.net/novel/show.php?id=10588915',
      },
      {
        rank: 2,
        title: '雨夜档案室',
        author: '示例作者',
        user_id: '37119297',
        novel_id: '10588869',
        words: 6399,
        characters: 11762,
        bookmarks: 1238,
        tags: '一般, 冒険',
        created: '2019-01-06',
        url: 'https://www.pixiv.net/novel/show.php?id=10588869',
      },
    ]);
  });

  it('respects the limit parameter', async () => {
    const page = createPageMock([
      { body: { novel: { data: [
        { id: '1', title: 'A', userName: 'u1', userId: '1', tags: [] },
        { id: '2', title: 'B', userName: 'u2', userId: '2', tags: [] },
        { id: '3', title: 'C', userName: 'u3', userId: '3', tags: [] },
      ] } } },
    ]);
    const result = await cmd.func(page, { query: 'test', limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no novel results', async () => {
    const page = createPageMock([{ body: { novel: { data: [] } } }]);
    const result = await cmd.func(page, { query: 'nonexistent', limit: 10 });
    expect(result).toEqual([]);
  });
});
