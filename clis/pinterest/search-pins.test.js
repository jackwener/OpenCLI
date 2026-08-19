import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './search-pins.js';

let cmd;

/** Wrap raw pin results in the resource_response envelope the endpoint returns. */
function searchResponse(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Cozy Nordic Living Room',
    description: 'Soft neutral tones and light wood.',
    pinner: { username: 'janedoe' },
    board: { name: 'Home' },
    images: { orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc.jpg' } },
    ...overrides,
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/search-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest search-pins', () => {
  it('throws ArgumentError on blank query', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { query: '   ', limit: 5 })).rejects.toThrow(ArgumentError);
  });

  it('throws AuthRequiredError on 401', async () => {
    const page = createPageMock([{ __httpError: 401 }]);
    await expect(cmd.func(page, { query: 'nordic interior', limit: 5 })).rejects.toThrow(AuthRequiredError);
  });

  it('throws CommandExecutionError on 403 (missing CSRF), not an auth prompt', async () => {
    const page = createPageMock([{ __httpError: 403 }]);
    await expect(cmd.func(page, { query: 'nordic interior', limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('maps pin fields into columns', async () => {
    const page = createPageMock([searchResponse([pin()])]);
    const result = await cmd.func(page, { query: 'nordic interior', limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      pinId: '111',
      title: 'Cozy Nordic Living Room',
      description: 'Soft neutral tones and light wood.',
      pinner: 'janedoe',
      board: 'Home',
      imageUrl: 'https://i.pinimg.com/originals/aa/bb/cc.jpg',
      url: 'https://www.pinterest.com/pin/111/',
    });
  });

  it('falls back to grid_title and best-available image; tolerates missing fields', async () => {
    const page = createPageMock([searchResponse([
      pin({ id: '222', title: '', grid_title: 'Grid Title', description: '  ', pinner: undefined, board: undefined, images: { '736x': { url: 'https://i.pinimg.com/736x/x.jpg' } } }),
    ])]);
    const result = await cmd.func(page, { query: 'x', limit: 10 });
    expect(result[0]).toMatchObject({
      pinId: '222',
      title: 'Grid Title',
      description: '',
      pinner: '',
      board: '',
      imageUrl: 'https://i.pinimg.com/736x/x.jpg',
    });
  });

  it('drops promoted (ad) pins and non-pin items', async () => {
    const page = createPageMock([searchResponse([
      pin({ id: '1' }),
      pin({ id: 'ad1', is_promoted: true }),
      { type: 'story', id: 's1' },
      pin({ id: '2' }),
    ])]);
    const result = await cmd.func(page, { query: 'x', limit: 10 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2']);
  });

  it('respects the limit and stops paginating once satisfied', async () => {
    const page = createPageMock([searchResponse([pin({ id: '1' }), pin({ id: '2' }), pin({ id: '3' })], 'bm1')]);
    const result = await cmd.func(page, { query: 'x', limit: 2 });
    expect(result).toHaveLength(2);
    // Only one page fetched: the second queued response is never consumed.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('paginates across pages via the bookmark, de-duplicating pins', async () => {
    const page = createPageMock([
      searchResponse([pin({ id: '1' }), pin({ id: '2' })], 'bm1'),
      searchResponse([pin({ id: '2' }), pin({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { query: 'x', limit: 5 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('throws EmptyResultError when no pins are found', async () => {
    const page = createPageMock([searchResponse([], null)]);
    await expect(cmd.func(page, { query: 'zzznope', limit: 10 })).rejects.toThrow(EmptyResultError);
  });
});
