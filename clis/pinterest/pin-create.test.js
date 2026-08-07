import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin-create.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'Home' } : {} } };
}

function created(id) {
  return { resource_response: { data: id ? { id, title: 'My Pin', board: { name: 'Home' } } : {} } };
}

const OK = { image: 'https://example.com/a.jpg', board: 'me/home' };

const sections = {
  resource_response: {
    data: [
      { id: 'sec-1', title: 'Cats', slug: 'cats', pin_count: 2 },
      { id: 'sec-2', title: 'Dogs', slug: 'dogs', pin_count: 0 },
    ],
  },
};

const updated = { resource_response: { data: { id: '42' } } };

const boardById = {
  resource_response: { data: { id: '999', name: 'My Board', url: '/janedoe/my-board/' } },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin-create');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin-create', () => {
  it('rejects a local file path (URL required)', async () => {
    await expect(cmd.func(createPageMock([]), { ...OK, image: './photo.jpg' })).rejects.toThrow(ArgumentError);
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

  it('throws AuthRequiredError when the create call is unauthorized', async () => {
    const page = createPageMock([boardMeta('999'), { __httpError: 401 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('resolves the board then creates the pin and returns its row', async () => {
    const page = createPageMock([boardMeta('999'), created('42')]);
    const result = await cmd.func(page, { ...OK, title: 'My Pin' });
    expect(result).toEqual([{
      pinId: '42',
      board: 'Home',
      title: 'My Pin',
      url: 'https://www.pinterest.com/pin/42/',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // BoardResource + PinResource/create
  });

  it('throws CommandExecutionError when the board id cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([boardMeta(null)]), OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError when create returns no pin id', async () => {
    const page = createPageMock([boardMeta('999'), created(null)]);
    await expect(cmd.func(page, OK)).rejects.toThrow(CommandExecutionError);
  });

  it('moves the new pin into the section with a follow-up update', async () => {
    const page = createPageMock([boardMeta('999'), sections, created('42'), updated]);
    await cmd.func(page, { ...OK, section: 'cats' });

    // PinResource/create must not carry a section: it answers 200 and files the pin at the root.
    const create = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[2][0].match(/data=([^"&]+)/)[1]));
    expect(create.options.board_id).toBe('999');
    expect(create.options.board_section_id).toBeUndefined();

    const move = page.evaluate.mock.calls[3][0];
    expect(move).toContain('/resource/PinResource/update/');
    const sent = JSON.parse(decodeURIComponent(move.match(/data=([^"&]+)/)[1]));
    expect(sent.options).toEqual({ id: '42', board_id: '999', board_section_id: 'sec-1' });
  });

  it('throws ArgumentError before creating when --section matches nothing', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { ...OK, section: 'birds' })).rejects.toThrow(/No section matching "birds"/);
    expect(page.evaluate).toHaveBeenCalledTimes(2); // nothing was created
  });
});
