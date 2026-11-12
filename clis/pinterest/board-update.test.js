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
      archived: false,
      url: 'https://www.pinterest.com/janedoe/new-name/',
    }]);
  });

  it('archives through the v3 archive endpoint without a BoardResource update', async () => {
    const page = createPageMock([boardMeta('999'), { resource_response: { data: null } }]);
    const result = await cmd.func(page, { board: 'janedoe/my-board', archive: true });
    expect(result[0]).toMatchObject({ boardId: '999', name: 'Old Name', archived: true });
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    const call = page.evaluate.mock.calls[1][0];
    expect(call).toContain('/resource/ApiResource/create/');
    const sent = JSON.parse(decodeURIComponent(call.match(/data=([^"&]+)/)[1]));
    expect(sent.options).toEqual({ url: '/v3/boards/999/archive/', data: {} });
  });

  it('unarchives with a delete on the same endpoint and rejects both flags together', async () => {
    const page = createPageMock([boardMeta('999'), { resource_response: { data: null } }]);
    const result = await cmd.func(page, { board: 'janedoe/my-board', unarchive: true });
    expect(result[0].archived).toBe(false);
    expect(page.evaluate.mock.calls[1][0]).toContain('/resource/ApiResource/delete/');

    await expect(cmd.func(createPageMock([]), { board: 'janedoe/my-board', archive: true, unarchive: true }))
      .rejects.toThrow(/cannot be combined/);
  });
});
