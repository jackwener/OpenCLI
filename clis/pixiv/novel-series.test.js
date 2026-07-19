import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './novel-series.js';

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novel-series');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv novel-series', () => {
  it('throws ArgumentError on invalid series ID before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { id: 'bad' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws CommandExecutionError on malformed series content payload', async () => {
    const page = createPageMock([
      { body: { title: '示例系列作品' } },
      { body: { page: {} } },
    ]);
    await expect(cmd.func(page, { id: '1064235', limit: 10 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError on malformed series novel detail payload', async () => {
    const page = createPageMock([
      { body: { title: '示例系列作品' } },
      { body: { page: { seriesContents: [{ id: '10588833' }] } } },
      { body: { id: '', title: '晨星图书馆纪行', userName: '示例作者', tags: { tags: [] } } },
    ]);
    await expect(cmd.func(page, { id: '1064235', limit: 10 })).rejects.toThrow(CommandExecutionError);
  });

  it('returns ordered novel rows for a series', async () => {
    const page = createPageMock([
      { body: { title: '示例系列作品', userName: '示例作者', userId: '37119297', publishedContentCount: 2 } },
      { body: { page: { seriesContents: [{ id: '10588833', userId: '37119297' }, { id: '10588915', userId: '37119297' }] } } },
      { body: { id: '10588833', title: '晨星图书馆纪行', userName: '示例作者', userId: '37119297', seriesNavData: { order: 1 }, tags: { tags: [{ tag: '一般' }] }, wordCount: 8972, characterCount: 16149, bookmarkCount: 2012, createDate: '2019-01-06T12:37:56+00:00' } },
      { body: { id: '10588915', title: '星之观测手记', userName: '示例作者', userId: '37119297', seriesNavData: { order: 4 }, tags: { tags: [{ tag: '一般' }, { tag: 'ファンタジー' }] }, wordCount: 75463, characterCount: 135811, bookmarkCount: 2829, createDate: '2019-01-06T12:48:16+00:00' } },
    ]);

    const result = await cmd.func(page, { id: '1064235', limit: 10 });
    expect(result).toEqual([
      { order: 1, novel_id: '10588833', title: '晨星图书馆纪行', author: '示例作者', words: 8972, characters: 16149, bookmarks: 2012, tags: '一般', created: '2019-01-06', url: 'https://www.pixiv.net/novel/show.php?id=10588833' },
      { order: 4, novel_id: '10588915', title: '星之观测手记', author: '示例作者', words: 75463, characters: 135811, bookmarks: 2829, tags: '一般, ファンタジー', created: '2019-01-06', url: 'https://www.pixiv.net/novel/show.php?id=10588915' },
    ]);
  });
});
