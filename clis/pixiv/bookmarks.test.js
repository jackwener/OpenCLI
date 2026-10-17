import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
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

});
