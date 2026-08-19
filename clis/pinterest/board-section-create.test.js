import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-section-create.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'My Board' } : {} } };
}

function created(id) {
  return { resource_response: { data: id ? { id, title: 'My Section', slug: 'my-section' } : {} } };
}

const OK = { board: 'janedoe/my-board', title: 'My Section' };

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-section-create');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-section-create', () => {
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

  it('throws ArgumentError on a blank title', async () => {
    await expect(cmd.func(createPageMock([]), { ...OK, title: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('throws CommandExecutionError when the board cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([boardMeta(null)]), OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError when the create is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), { __httpError: 403 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('creates the section and returns its row', async () => {
    const page = createPageMock([boardMeta('999'), created('42')]);
    const result = await cmd.func(page, OK);
    expect(result).toEqual([{
      sectionId: '42',
      title: 'My Section',
      slug: 'my-section',
      board: 'janedoe/my-board',
      url: 'https://www.pinterest.com/janedoe/my-board/my-section/',
    }]);
  });

  it('throws CommandExecutionError when create returns no section id', async () => {
    const page = createPageMock([boardMeta('999'), created(null)]);
    await expect(cmd.func(page, OK)).rejects.toThrow(CommandExecutionError);
  });
});
