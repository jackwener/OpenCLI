import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './user-pins.js';

let cmd;

function feed(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Nordic Chair',
    description: 'Light wood.',
    pinner: { username: 'janedoe' },
    board: { name: 'Furniture' },
    images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.jpg' } },
    ...overrides,
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/user-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest user-pins', () => {
  it('throws ArgumentError on blank username', async () => {
    await expect(cmd.func(createPageMock([]), { username: '  ', limit: 5 })).rejects.toThrow(ArgumentError);
  });

  it('accepts profile URL form', async () => {
    const page = createPageMock([feed([pin()])]);
    const result = await cmd.func(page, { username: 'https://www.pinterest.com/janedoe/', limit: 5 });
    expect(result).toHaveLength(1);
  });

  it('rejects an @-prefixed username (Pinterest has no @-handles)', async () => {
    await expect(cmd.func(createPageMock([feed([pin()])]), { username: '@janedoe', limit: 5 }))
      .rejects.toThrow(ArgumentError);
  });

  it('throws AuthRequiredError on 401', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 401 }]), { username: 'janedoe', limit: 5 })).rejects.toThrow(AuthRequiredError);
  });

  it('throws CommandExecutionError on 403', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 403 }]), { username: 'janedoe', limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('maps pin fields and drops ads/non-pins', async () => {
    const page = createPageMock([feed([
      pin({ id: '1' }),
      pin({ id: 'ad', is_promoted: true }),
      { type: 'story', id: 's' },
      pin({ id: '2' }),
    ])]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 10 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2']);
    expect(result[0]).toMatchObject({ pinner: 'janedoe', board: 'Furniture', url: 'https://www.pinterest.com/pin/1/' });
  });

  it('paginates via bookmark and de-duplicates', async () => {
    const page = createPageMock([
      feed([pin({ id: '1' }), pin({ id: '2' })], 'bm1'),
      feed([pin({ id: '2' }), pin({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 5 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('throws EmptyResultError when the user has no pins', async () => {
    await expect(cmd.func(createPageMock([feed([], null)]), { username: 'ghost', limit: 5 })).rejects.toThrow(EmptyResultError);
  });
});
