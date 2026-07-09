import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './novels.js';

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novels');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv novels', () => {
  it('throws CommandExecutionError on invalid user ID before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'user-id': 'abc' })).rejects.toThrow(CommandExecutionError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('returns empty array when the user has no novels', async () => {
    const page = createPageMock([{ body: { novels: {} } }]);
    const result = await cmd.func(page, { 'user-id': '37119297', limit: 10 });
    expect(result).toEqual([]);
  });

  it('batch fetches user novel details and maps stable fields', async () => {
    const page = createPageMock([
      { body: { novels: { '10588833': null, '10588915': null } } },
      {
        body: {
          works: {
            '10588915': {
              id: '10588915',
              title: '星之观测手记',
              userName: '示例作者',
              userId: '37119297',
              tags: ['一般', '中文'],
              wordCount: 75463,
              textCount: 135811,
              bookmarkCount: 2829,
              createDate: '2019-01-06T21:48:16+09:00',
            },
            '10588833': {
              id: '10588833',
              title: '晨星图书馆纪行',
              userName: '示例作者',
              userId: '37119297',
              tags: ['一般', '日常'],
              wordCount: 8972,
              textCount: 16149,
              bookmarkCount: 2012,
              createDate: '2019-01-06T21:37:56+09:00',
            },
          },
        },
      },
    ]);

    const result = await cmd.func(page, { 'user-id': '37119297', limit: 2 });
    expect(result).toEqual([
      {
        rank: 1,
        title: '星之观测手记',
        novel_id: '10588915',
        words: 75463,
        characters: 135811,
        bookmarks: 2829,
        tags: '一般, 中文',
        created: '2019-01-06',
        url: 'https://www.pixiv.net/novel/show.php?id=10588915',
      },
      {
        rank: 2,
        title: '晨星图书馆纪行',
        novel_id: '10588833',
        words: 8972,
        characters: 16149,
        bookmarks: 2012,
        tags: '一般, 日常',
        created: '2019-01-06',
        url: 'https://www.pixiv.net/novel/show.php?id=10588833',
      },
    ]);

    const secondFetch = page.evaluate.mock.calls[1]?.[0] || '';
    expect(secondFetch).toContain('/ajax/user/37119297/profile/novels?ids[]');
  });
});
