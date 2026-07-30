import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-delete.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'My Board', pin_count: 7 } : {} } };
}

const deleted = { resource_response: { data: null } };
const OK = { board: 'janedoe/my-board', confirm: true };

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-delete');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-delete', () => {
  it('throws ArgumentError on a board reference that is neither <username>/<slug> nor an id', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { ...OK, board: 'My Board' })).rejects.toThrow(/Not a board reference/);
    expect(page.evaluate).not.toHaveBeenCalled(); // rejected without a lookup
  });

  it('resolves a numeric board id without re-fetching the board', async () => {
    const page = createPageMock([boardById, boardById]);
    await cmd.func(page, { ...OK, board: '720576077819585951' }).catch(() => {});
    const lookup = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(lookup.options.board_id).toBe('720576077819585951');
    // The board fetched above is reused, so no second BoardResource lookup goes out.
    const followUp = page.evaluate.mock.calls[1]?.[0] ?? '';
    expect(followUp).not.toContain('/resource/BoardResource/get/');
  });

  it('refuses to delete without --confirm', async () => {
    const page = createPageMock([boardMeta('999')]);
    await expect(cmd.func(page, { board: 'janedoe/my-board' })).rejects.toThrow(/--confirm/);
    expect(page.evaluate).toHaveBeenCalledTimes(1); // resolved the board, never deleted
  });

  it('throws CommandExecutionError when the board cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([boardMeta(null)]), OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError when the delete is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), { __httpError: 403 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('deletes the board and reports the row', async () => {
    const page = createPageMock([boardMeta('999'), deleted]);
    const result = await cmd.func(page, OK);
    expect(result).toEqual([{ boardId: '999', name: 'My Board', pinCount: 7, deleted: true }]);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});
