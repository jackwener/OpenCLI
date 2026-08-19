import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './save.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'Home' } : {} } };
}

function repinned(id) {
  return { resource_response: { data: id ? { id, board: { name: 'Home' } } : {} } };
}

const sections = {
  resource_response: {
    data: [
      { id: 'sec-1', title: 'Cats', slug: 'cats', pin_count: 2 },
      { id: 'sec-2', title: 'Dogs', slug: 'dogs', pin_count: 0 },
    ],
  },
};

const updated = { resource_response: { data: { id: '42' } } };

const OK = { pin: '1234567890123456', board: 'me/home' };

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/save');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest save', () => {
  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { ...OK, pin: 'nope' })).rejects.toThrow(ArgumentError);
  });

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

  it('throws CommandExecutionError when the board id cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([boardMeta(null)]), OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError when the repin is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), { __httpError: 401 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('resolves the board then repins and returns the row', async () => {
    const page = createPageMock([boardMeta('999'), repinned('42')]);
    const result = await cmd.func(page, OK);
    expect(result).toEqual([{
      pinId: '42',
      sourcePinId: '1234567890123456',
      board: 'Home',
      url: 'https://www.pinterest.com/pin/42/',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('moves the repin into the section with a follow-up update', async () => {
    const page = createPageMock([boardMeta('999'), sections, repinned('42'), updated]);
    await cmd.func(page, { ...OK, section: 'cats' });

    // RepinResource/create must not carry a section: it answers 200 and ignores it.
    const repin = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[2][0].match(/data=([^"&]+)/)[1]));
    expect(repin.options.board_id).toBe('999');
    expect(repin.options.board_section_id).toBeUndefined();

    const move = page.evaluate.mock.calls[3][0];
    expect(move).toContain('/resource/PinResource/update/');
    const sent = JSON.parse(decodeURIComponent(move.match(/data=([^"&]+)/)[1]));
    expect(sent.options).toEqual({ id: '42', board_id: '999', board_section_id: 'sec-1' });
  });

  it('throws ArgumentError before repinning when --section matches nothing', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { ...OK, section: 'birds' })).rejects.toThrow(/No section matching "birds"/);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // nothing was created
  });

  it('reports the created pin id when the section move fails', async () => {
    const page = createPageMock([boardMeta('999'), sections, repinned('42'), { __httpError: 500 }]);
    await expect(cmd.func(page, { ...OK, section: 'sec-1' })).rejects.toThrow(/42 was created but could not be moved/);
  });

  it('throws CommandExecutionError when the repin returns no id', async () => {
    const page = createPageMock([boardMeta('999'), repinned(null)]);
    await expect(cmd.func(page, OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws ArgumentError for --section without --board instead of dropping it', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { pin: '1234567890123456', section: 'cats' }))
      .rejects.toThrow(/--section requires --board/);
    expect(page.evaluate).not.toHaveBeenCalled(); // nothing was repinned
  });

  it('saves to profile when no board is given (skips board lookup)', async () => {
    const page = createPageMock([{ resource_response: { data: { id: '43', board: { name: 'Profile' } } } }]);
    const result = await cmd.func(page, { pin: '1234567890123456' });
    expect(result).toEqual([{
      pinId: '43',
      sourcePinId: '1234567890123456',
      board: 'Profile',
      url: 'https://www.pinterest.com/pin/43/',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('labels the profile save "profile" when the repin omits a board', async () => {
    const page = createPageMock([{ resource_response: { data: { id: '44' } } }]);
    const result = await cmd.func(page, { pin: '1234567890123456' });
    expect(result[0].board).toBe('profile');
  });
});
