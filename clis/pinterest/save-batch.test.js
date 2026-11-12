import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './save-batch.js';

let cmd;

const boardMeta = { resource_response: { data: { id: '999', name: 'Home' } } };
const repinned = (id) => ({ resource_response: { data: { id, board: { name: 'Home' } } } });

beforeAll(() => {
  cmd = getRegistry().get('pinterest/save-batch');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest save-batch', () => {
  it('rejects --section without --board before saving anything', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { pins: '111', section: 'cats' })).rejects.toThrow(/--section requires --board/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('resolves the board once and reports each repin, including a failed one', async () => {
    const page = createPageMock([boardMeta, repinned('901'), { __httpError: 404, message: 'not found' }]);
    const rows = await cmd.func(page, { pins: '111,222', board: 'me/home' });
    expect(rows[0]).toMatchObject({ sourcePinId: '111', pinId: '901', board: 'Home', status: 'success' });
    expect(rows[1]).toMatchObject({ sourcePinId: '222', pinId: '', status: 'failed' });
    expect(page.evaluate).toHaveBeenCalledTimes(3); // board + one repin per pin
  });
});
