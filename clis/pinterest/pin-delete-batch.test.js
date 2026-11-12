import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin-delete-batch.js';

let cmd;

const deleted = { resource_response: { data: null } };

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin-delete-batch');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin-delete-batch', () => {
  it('refuses to delete without --confirm and sends nothing', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { pins: '111,222' })).rejects.toThrow(/Refusing to delete 2 pins without --confirm/);
    await expect(cmd.func(page, { pins: 'nope', confirm: true })).rejects.toThrow(ArgumentError);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('deletes each pin and reports a failure as a row', async () => {
    const page = createPageMock([deleted, { __httpError: 404, message: 'not found' }]);
    const rows = await cmd.func(page, { pins: '111,222', confirm: true });
    expect(rows).toEqual([
      { pinId: '111', deleted: true, status: 'success', message: '' },
      { pinId: '222', deleted: false, status: 'failed', message: expect.stringMatching(/not found/) },
    ]);
    expect(page.evaluate.mock.calls[0][0]).toContain('/resource/PinResource/delete/');
  });
});
