import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-pins.js';

let cmd;

/** BoardResource response: the raw board object under resource_response.data. */
function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'My Board' } : {} } };
}

function feed(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Wallpaper',
    description: '',
    pinner: { username: 'janedoe' },
    board: { name: 'My Board' },
    images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.jpg' } },
    ...overrides,
  };
}

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-pins', () => {
  it('throws ArgumentError on a board reference that is neither <username>/<slug> nor an id', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { board: 'My Board', limit: 5 })).rejects.toThrow(/Not a board reference/);
    expect(page.evaluate).not.toHaveBeenCalled(); // rejected without a lookup
  });

  it('resolves a numeric board id without re-fetching the board', async () => {
    const page = createPageMock([boardById, boardById]);
    await cmd.func(page, { board: '720576077819585951', limit: 5 }).catch(() => {});
    const lookup = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(lookup.options.board_id).toBe('720576077819585951');
    // The board fetched above is reused, so no second BoardResource lookup goes out.
    const followUp = page.evaluate.mock.calls[1]?.[0] ?? '';
    expect(followUp).not.toContain('/resource/BoardResource/get/');
  });

  it('accepts full URL and username/slug forms', async () => {
    for (const board of ['https://www.pinterest.com/janedoe/my-board/', 'janedoe/my-board']) {
      const page = createPageMock([boardMeta('999'), feed([pin()])]);
      const result = await cmd.func(page, { board, limit: 5 });
      expect(result).toHaveLength(1);
    }
  });

  it('throws CommandExecutionError when the board id cannot be resolved', async () => {
    const page = createPageMock([boardMeta(null)]);
    await expect(cmd.func(page, { board: 'janedoe/missing', limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('resolves the board id then maps feed pins, dropping ads', async () => {
    const page = createPageMock([
      boardMeta('999'),
      feed([pin({ id: '1' }), pin({ id: 'ad', is_promoted: true }), pin({ id: '2' })]),
    ]);
    const result = await cmd.func(page, { board: 'janedoe/my-board', limit: 10 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2']);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // BoardResource + one feed page
  });

  it('throws EmptyResultError when the board has no pins', async () => {
    const page = createPageMock([boardMeta('999'), feed([], null)]);
    await expect(cmd.func(page, { board: 'janedoe/empty', limit: 5 })).rejects.toThrow(EmptyResultError);
  });
});
