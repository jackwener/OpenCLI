import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './bookmarks.js';

let cmd;
const loggedInPage = (results) => createPageMock(results, {
  getCookies: vi.fn().mockResolvedValue([{ name: 'PHPSESSID', value: '37119297_session' }]),
});

beforeAll(() => {
  cmd = getRegistry().get('pixiv/bookmarks');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv bookmarks', () => {
  it('lists current account illustration bookmarks', async () => {
    const page = loggedInPage([
      { found: true, user: { id: '37119297', name: '示例用户' } },
      { body: { works: [{
        id: '12345', title: '星空', userName: '作者A', userId: '100', pageCount: 2,
        bookmarkCount: 33, tags: ['風景', '星'], createDate: '2026-05-01T00:00:00+00:00',
      }], total: 1 } },
    ]);

    await expect(cmd.func(page, { type: 'illust', limit: 10 })).resolves.toEqual([{
      rank: 1,
      type: 'illust',
      bookmark_owner_id: '37119297',
      title: '星空',
      author: '作者A',
      user_id: '100',
      illust_id: '12345',
      novel_id: '',
      pages: 2,
      words: '',
      bookmarks: 33,
      tags: '風景, 星',
      created: '2026-05-01',
      url: 'https://www.pixiv.net/artworks/12345',
    }]);
  });

  it('lists current account novel bookmarks', async () => {
    const page = loggedInPage([
      { found: true, user: { id: '37119297', name: '示例用户' } },
      { body: { works: [{
        id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200',
        wordCount: 75463, textCount: 135811, bookmarkCount: 2829,
        tags: ['一般', '中文'], createDate: '2019-01-06T12:48:16+00:00',
      }], total: 1 } },
    ]);

    await expect(cmd.func(page, { type: 'novel', limit: 5 })).resolves.toEqual([{
      rank: 1,
      type: 'novel',
      bookmark_owner_id: '37119297',
      title: '星之观测手记',
      author: '作者B',
      user_id: '200',
      illust_id: '',
      novel_id: '10588915',
      pages: '',
      words: 75463,
      bookmarks: 2829,
      tags: '一般, 中文',
      created: '2019-01-06',
      url: 'https://www.pixiv.net/novel/show.php?id=10588915',
    }]);
  });

  it('supports offset pagination params', async () => {
    const page = loggedInPage([{ found: true, user: { id: '37119297' } }, { body: { works: [], total: 0 } }]);
    await cmd.func(page, { type: 'illust', limit: 25, offset: 50, visibility: 'hide' });
    expect(page.evaluate.mock.calls[1][0]).toContain('/ajax/user/37119297/illusts/bookmarks');
    expect(page.evaluate.mock.calls[1][0]).toContain('limit=25');
    expect(page.evaluate.mock.calls[1][0]).toContain('offset=50');
    expect(page.evaluate.mock.calls[1][0]).toContain('rest=hide');
  });

  it('throws ArgumentError on coerced pagination strings before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { type: 'illust', limit: '1e2' })).rejects.toThrow(ArgumentError);
    await expect(cmd.func(page, { type: 'illust', limit: '020' })).rejects.toThrow(ArgumentError);
    await expect(cmd.func(page, { type: 'illust', offset: ' 1 ' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws CommandExecutionError on malformed bookmark payload shape', async () => {
    const page = loggedInPage([{ found: true, user: { id: '37119297' } }, { body: { unexpected: [] } }]);
    await expect(cmd.func(page, { type: 'illust', limit: 10 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError on malformed bookmark identity', async () => {
    const page = loggedInPage([
      { found: true, user: { id: '37119297' } },
      { body: { works: [{ id: '../escape', title: '星空', userName: '作者A', userId: '100', tags: [] }] } },
    ]);
    await expect(cmd.func(page, { type: 'illust', limit: 10 })).rejects.toThrow(CommandExecutionError);
  });

  it('throws ArgumentError on invalid type before fetching bookmarks', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { type: 'music' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError when not logged in', async () => {
    const page = createPageMock([{ found: false, user: null }]);
    await expect(cmd.func(page, { type: 'illust' })).rejects.toThrow(AuthRequiredError);
  });

  it('fails typed on malformed row metrics or tags instead of emitting objects', async () => {
    const malformedMetrics = loggedInPage([
      { found: true, user: { id: '37119297' } },
      { body: { works: [{ id: '1', title: 'A', userName: 'B', userId: '2', pageCount: {}, tags: [] }] } },
    ]);
    await expect(cmd.func(malformedMetrics, { type: 'illust' })).rejects.toThrow(CommandExecutionError);

    const malformedTags = loggedInPage([
      { found: true, user: { id: '37119297' } },
      { body: { works: [{ id: '1', title: 'A', userName: 'B', userId: '2', tags: ['ok', {}] }] } },
    ]);
    await expect(cmd.func(malformedTags, { type: 'illust' })).rejects.toThrow(CommandExecutionError);
  });
});
