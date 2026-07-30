import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-sections.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id } : {} } };
}

function sections(list) {
  return { resource_response: { data: list } };
}

function section(overrides = {}) {
  return { id: '9876543210987654', title: 'My Section', slug: 'my-section', pin_count: 6, ...overrides };
}

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-sections');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-sections', () => {
  it('throws ArgumentError on a board reference that is neither <username>/<slug> nor an id', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { board: 'My Board' })).rejects.toThrow(/Not a board reference/);
    expect(page.evaluate).not.toHaveBeenCalled(); // rejected without a lookup
  });

  it('resolves a numeric board id without re-fetching the board', async () => {
    const page = createPageMock([boardById, boardById]);
    await cmd.func(page, { board: '720576077819585951' }).catch(() => {});
    const lookup = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(lookup.options.board_id).toBe('720576077819585951');
    // The board fetched above is reused, so no second BoardResource lookup goes out.
    const followUp = page.evaluate.mock.calls[1]?.[0] ?? '';
    expect(followUp).not.toContain('/resource/BoardResource/get/');
  });

  it('throws CommandExecutionError when the board id cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([boardMeta(null)]), { board: 'janedoe/missing' })).rejects.toThrow(CommandExecutionError);
  });

  it('resolves the board then maps sections', async () => {
    const page = createPageMock([boardMeta('999'), sections([section(), section({ id: '2', title: 'Fall', slug: 'fall', pin_count: 37 })])]);
    const result = await cmd.func(page, { board: 'janedoe/my-board', limit: 10 });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      sectionId: '9876543210987654',
      title: 'My Section',
      slug: 'my-section',
      pinCount: 6,
      url: 'https://www.pinterest.com/janedoe/my-board/my-section/',
    });
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('throws EmptyResultError when the board has no sections', async () => {
    await expect(cmd.func(createPageMock([boardMeta('999'), sections([])]), { board: 'janedoe/plain' })).rejects.toThrow(EmptyResultError);
  });
});
