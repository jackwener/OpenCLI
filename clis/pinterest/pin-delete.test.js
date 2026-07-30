import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin-delete.js';

let cmd;

function pinDetail(id) {
  return { resource_response: { data: id ? { id, title: 'My Pin', board: { name: 'My Board' } } : {} } };
}

const deleted = { resource_response: { data: null } };
const OK = { pin: '1234567890123456', confirm: true };

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin-delete');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin-delete', () => {
  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { ...OK, pin: 'nope' })).rejects.toThrow(ArgumentError);
  });

  it('refuses to delete without --confirm', async () => {
    const page = createPageMock([pinDetail('1234567890123456')]);
    await expect(cmd.func(page, { pin: '1234567890123456' })).rejects.toThrow(/--confirm/);
    expect(page.evaluate).toHaveBeenCalledTimes(1); // looked the pin up, never deleted
  });

  it('throws CommandExecutionError when the pin cannot be resolved', async () => {
    await expect(cmd.func(createPageMock([pinDetail(null)]), OK)).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError when the delete is unauthorized', async () => {
    const page = createPageMock([pinDetail('1234567890123456'), { __httpError: 401 }]);
    await expect(cmd.func(page, OK)).rejects.toThrow(AuthRequiredError);
  });

  it('accepts a pin URL, deletes it, and reports the row', async () => {
    const page = createPageMock([pinDetail('1234567890123456'), deleted]);
    const result = await cmd.func(page, { pin: 'https://www.pinterest.com/pin/1234567890123456/', confirm: true });
    expect(result).toEqual([{
      pinId: '1234567890123456',
      title: 'My Pin',
      board: 'My Board',
      deleted: true,
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});
