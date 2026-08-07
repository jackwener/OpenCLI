import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-section-delete.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'My Board' } : {} } };
}

const sections = {
  resource_response: {
    data: [
      { id: '42', title: 'Cats', slug: 'cats', pin_count: 3 },
      { id: '43', title: 'Dogs', slug: 'dogs', pin_count: 1 },
      { id: '44', title: 'Big Cats', slug: 'big-cats', pin_count: 0 },
    ],
  },
};

const deleted = { resource_response: { data: null } };
const OK = { board: 'janedoe/my-board', section: '42', confirm: true };

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-section-delete');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-section-delete', () => {
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

  it('throws ArgumentError on a blank section', async () => {
    await expect(cmd.func(createPageMock([]), { ...OK, section: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('throws ArgumentError listing the real sections when nothing matches', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { ...OK, section: 'birds' })).rejects.toThrow(/No section matching "birds"/);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // resolved, never deleted
  });

  it('accepts a section slug', async () => {
    const page = createPageMock([boardMeta('999'), sections, deleted]);
    const result = await cmd.func(page, { ...OK, section: 'dogs' });
    expect(result[0].sectionId).toBe('43');
  });

  it('accepts a section slug case-insensitively', async () => {
    const page = createPageMock([boardMeta('999'), sections, deleted]);
    const result = await cmd.func(page, { ...OK, section: 'CATS' });
    expect(result[0].sectionId).toBe('42');
  });

  it('does not match a section by its display title', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { ...OK, section: 'Big Cats' })).rejects.toThrow(/No section matching "Big Cats"/);
  });

  it('refuses to delete without --confirm, naming the resolved section', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { board: 'janedoe/my-board', section: '42' })).rejects.toThrow(/Cats.*--confirm/);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // board + sections lookup only, no delete
  });

  it('throws AuthRequiredError when the delete is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), sections, { __httpError: 403 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('deletes the section and reports the row', async () => {
    const page = createPageMock([boardMeta('999'), sections, deleted]);
    const result = await cmd.func(page, OK);
    expect(result).toEqual([{ sectionId: '42', board: 'janedoe/my-board', deleted: true }]);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('deletes via the v3 API proxy (BoardSectionResource has no delete)', async () => {
    const page = createPageMock([boardMeta('999'), sections, deleted]);
    await cmd.func(page, OK);
    const script = page.evaluate.mock.calls[2][0];
    expect(script).toContain('/resource/ApiResource/delete/');
    const sent = JSON.parse(decodeURIComponent(script.match(/data=([^"&]+)/)[1]));
    expect(sent.options.url).toBe('/v3/board/sections/42/');
  });
});
