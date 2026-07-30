import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-update.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'Old Name' } : {} } };
}

function updated(overrides = {}) {
  return { resource_response: { data: { id: '999', name: 'New Name', privacy: 'secret', url: '/janedoe/new-name/', ...overrides } } };
}

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-update');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-update', () => {
  it('throws ArgumentError on a board reference that is neither <username>/<slug> nor an id', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { board: 'My Board', name: 'x' })).rejects.toThrow(/Not a board reference/);
    expect(page.evaluate).not.toHaveBeenCalled(); // rejected without a lookup
  });

  it('resolves a numeric board id without re-fetching the board', async () => {
    const page = createPageMock([boardById, boardById]);
    await cmd.func(page, { board: '720576077819585951', name: 'x' }).catch(() => {});
    const lookup = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(lookup.options.board_id).toBe('720576077819585951');
    // The board fetched above is reused, so no second BoardResource lookup goes out.
    const followUp = page.evaluate.mock.calls[1]?.[0] ?? '';
    expect(followUp).not.toContain('/resource/BoardResource/get/');
  });

  it('throws ArgumentError when no field is given', async () => {
    await expect(cmd.func(createPageMock([]), { board: 'janedoe/my-board' })).rejects.toThrow(/nothing to update/);
  });

  it('throws ArgumentError on an unknown privacy value', async () => {
    await expect(cmd.func(createPageMock([]), { board: 'janedoe/my-board', privacy: 'hidden' })).rejects.toThrow(ArgumentError);
  });

  it('throws CommandExecutionError when the board cannot be resolved', async () => {
    const page = createPageMock([boardMeta(null)]);
    await expect(cmd.func(page, { board: 'janedoe/my-board', name: 'New Name' })).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError when the update is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), { __httpError: 403 }]);
    await expect(cmd.func(page, { board: 'janedoe/my-board', name: 'New Name' })).rejects.toThrow(AuthRequiredError);
  });

  it('sends only the fields that were passed', async () => {
    const page = createPageMock([boardMeta('999'), updated()]);
    await cmd.func(page, { board: 'janedoe/my-board', name: 'New Name', privacy: 'secret' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[1][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options).toEqual({ board_id: '999', name: 'New Name', privacy: 'secret' });
  });

  it('returns the updated row', async () => {
    const page = createPageMock([boardMeta('999'), updated()]);
    const result = await cmd.func(page, { board: 'janedoe/my-board', name: 'New Name' });
    expect(result).toEqual([{
      boardId: '999',
      name: 'New Name',
      privacy: 'secret',
      url: 'https://www.pinterest.com/janedoe/new-name/',
    }]);
  });
});
