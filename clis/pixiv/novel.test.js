import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './novel.js';

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novel');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv novel', () => {
  it('throws ArgumentError on invalid novel ID before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { id: 'abc' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError on 401', async () => {
    const page = createPageMock([{ __httpError: 401 }]);
    await expect(cmd.func(page, { id: '10588915' })).rejects.toThrow(AuthRequiredError);
  });

  it('fails typed when the novel body lacks stable identity fields', async () => {
    const page = createPageMock([{ body: { title: 'Missing ID' } }]);
    await expect(cmd.func(page, { id: '10588915' })).rejects.toThrow(CommandExecutionError);
  });

  it('returns one metadata row without copying novel text content', async () => {
    const page = createPageMock([
      {
        body: {
          id: '10588915',
          title: '星之观测手记  原（观测者的旅行）',
          userName: '示例作者',
          userId: '37119297',
          seriesNavData: { seriesId: 1064235, title: '示例系列作品', order: 4 },
          tags: { tags: [{ tag: '一般' }, { tag: '中文' }, { tag: 'ファンタジー' }] },
          wordCount: 75463,
          characterCount: 135811,
          bookmarkCount: 2829,
          likeCount: 2943,
          viewCount: 36694,
          createDate: '2019-01-06T12:48:16+00:00',
          uploadDate: '2019-03-14T21:44:14+00:00',
          xRestrict: 1,
          isOriginal: false,
          content: 'FULL TEXT MUST NOT APPEAR IN OUTPUT',
        },
      },
    ]);

    const result = await cmd.func(page, { id: '10588915' });
    expect(result).toEqual([{
      novel_id: '10588915',
      title: '星之观测手记  原（观测者的旅行）',
      author: '示例作者',
      user_id: '37119297',
      series_id: '1064235',
      series_title: '示例系列作品',
      series_order: 4,
      words: 75463,
      characters: 135811,
      bookmarks: 2829,
      likes: 2943,
      views: 36694,
      tags: '一般, 中文, ファンタジー',
      created: '2019-01-06',
      url: 'https://www.pixiv.net/novel/show.php?id=10588915',
    }]);
    expect(JSON.stringify(result)).not.toContain('FULL TEXT');
  });
});
