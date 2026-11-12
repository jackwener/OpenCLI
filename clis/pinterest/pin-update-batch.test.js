import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin-update-batch.js';

let cmd;

const boardMeta = { resource_response: { data: { id: '999', name: 'Target Board' } } };
const sections = { resource_response: { data: [{ id: 'sec-1', title: 'Cats', slug: 'cats' }] } };
const updated = (id) => ({ resource_response: { data: { id, title: 'T', board: { name: 'Target Board' } } } });

const sentOptions = (page, call) => JSON.parse(decodeURIComponent(page.evaluate.mock.calls[call][0].match(/data=([^"&]+)/)[1])).options;

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin-update-batch');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin-update-batch', () => {
  it('rejects an empty list, a bad pin reference, and a call with nothing to update', async () => {
    await expect(cmd.func(createPageMock([]), { pins: ' , ', title: 'x' })).rejects.toThrow(/at least one pin/);
    await expect(cmd.func(createPageMock([]), { pins: '111,nope', title: 'x' })).rejects.toThrow(ArgumentError);
    await expect(cmd.func(createPageMock([]), { pins: '111,222' })).rejects.toThrow(/nothing to update/);
  });

  it('resolves the board and section once, then updates each unique pin', async () => {
    const page = createPageMock([boardMeta, sections, updated('111'), updated('222')]);
    const rows = await cmd.func(page, { pins: '111, https://www.pinterest.com/pin/222/ ,111', board: 'janedoe/target-board', section: 'cats' });
    expect(rows.map((r) => [r.pinId, r.status])).toEqual([['111', 'success'], ['222', 'success']]);
    expect(page.evaluate).toHaveBeenCalledTimes(4); // board + sections + one update per pin
    expect(sentOptions(page, 3)).toEqual({ id: '222', board_id: '999', board_section_id: 'sec-1' });
  });

  it('reports a failed pin as a row and carries on with the rest', async () => {
    const page = createPageMock([{ __httpError: 404, message: 'not found' }, updated('222')]);
    const rows = await cmd.func(page, { pins: '111,222', title: 'T' });
    expect(rows[0]).toMatchObject({ pinId: '111', status: 'failed' });
    expect(rows[0].message).toMatch(/not found/);
    expect(rows[1]).toMatchObject({ pinId: '222', status: 'success', title: 'T' });
  });

  it('rethrows the first error when every pin fails', async () => {
    const page = createPageMock([{ __httpError: 401 }, { __httpError: 401 }]);
    await expect(cmd.func(page, { pins: '111,222', title: 'T' })).rejects.toThrow(AuthRequiredError);
  });
});
