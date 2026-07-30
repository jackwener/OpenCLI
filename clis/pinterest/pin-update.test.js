import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin-update.js';

let cmd;

function boardMeta(id) {
  return { resource_response: { data: id ? { id, name: 'Target Board' } : {} } };
}

function updated(overrides = {}) {
  return { resource_response: { data: { id: '1234567890123456', title: 'New Title', board: { name: 'Target Board' }, ...overrides } } };
}

const sections = {
  resource_response: {
    data: [
      { id: 'sec-1', title: 'Cats', slug: 'cats', pin_count: 2 },
      { id: 'sec-2', title: 'Dogs', slug: 'dogs', pin_count: 0 },
    ],
  },
};

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin-update');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin-update', () => {
  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { pin: 'nope', title: 'x' })).rejects.toThrow(ArgumentError);
  });

  it('throws ArgumentError when no field is given', async () => {
    await expect(cmd.func(createPageMock([]), { pin: '1234567890123456' })).rejects.toThrow(/nothing to update/);
  });

  it('throws ArgumentError when --section is used without --board', async () => {
    await expect(cmd.func(createPageMock([]), { pin: '1234567890123456', title: 'x', section: 'sec-1' }))
      .rejects.toThrow(/--section requires --board/);
  });

  it('updates text without touching the board (single call)', async () => {
    const page = createPageMock([updated()]);
    const result = await cmd.func(page, { pin: '1234567890123456', title: 'New Title' });
    expect(result).toEqual([{
      pinId: '1234567890123456',
      title: 'New Title',
      board: 'Target Board',
      url: 'https://www.pinterest.com/pin/1234567890123456/',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(1); // no board lookup needed
  });

  it('resolves the board and the section when moving the pin', async () => {
    const page = createPageMock([boardMeta('999'), sections, updated()]);
    await cmd.func(page, { pin: '1234567890123456', board: 'janedoe/target-board', section: 'dogs' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[2][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options).toEqual({ id: '1234567890123456', board_id: '999', board_section_id: 'sec-2' });
  });

  it('throws ArgumentError when --section matches no section on the board', async () => {
    const page = createPageMock([boardMeta('999'), sections]);
    await expect(cmd.func(page, { pin: '1234567890123456', board: 'janedoe/target-board', section: 'birds' }))
      .rejects.toThrow(/No section matching "birds"/);
  });

  it('throws AuthRequiredError when the update is unauthorized', async () => {
    const page = createPageMock([{ __httpError: 401 }]);
    await expect(cmd.func(page, { pin: '1234567890123456', title: 'x' })).rejects.toThrow(AuthRequiredError);
  });

  it('throws CommandExecutionError when the update returns no pin', async () => {
    const page = createPageMock([{ resource_response: { data: {} } }]);
    await expect(cmd.func(page, { pin: '1234567890123456', title: 'x' })).rejects.toThrow(CommandExecutionError);
  });

  it('clears the description when --description "" is passed', async () => {
    const page = createPageMock([updated()]);
    await cmd.func(page, { pin: '1234567890123456', description: '' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options.description).toBe('');
  });

  it('leaves description untouched when the flag is omitted', async () => {
    const page = createPageMock([updated()]);
    await cmd.func(page, { pin: '1234567890123456', title: 'New Title' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect('description' in sent.options).toBe(false);
  });
});
