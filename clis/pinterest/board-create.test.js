import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './board-create.js';

let cmd;

function createdBoard(id) {
  return { resource_response: { data: id ? { id, name: 'My Board', privacy: 'public', url: '/me/my-board/' } : {} } };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-create');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-create', () => {
  it('throws ArgumentError on a blank name', async () => {
    await expect(cmd.func(createPageMock([]), { name: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('throws ArgumentError on an invalid privacy', async () => {
    await expect(cmd.func(createPageMock([]), { name: 'My Board', privacy: 'hidden' })).rejects.toThrow(ArgumentError);
  });

  it('throws AuthRequiredError when unauthorized', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 401 }]), { name: 'My Board' })).rejects.toThrow(AuthRequiredError);
  });

  it('creates the board and returns the row', async () => {
    const result = await cmd.func(createPageMock([createdBoard('77')]), { name: 'My Board', privacy: 'public' });
    expect(result).toEqual([{
      boardId: '77',
      name: 'My Board',
      privacy: 'public',
      url: 'https://www.pinterest.com/me/my-board/',
    }]);
  });

  it('throws CommandExecutionError when create returns no board id', async () => {
    await expect(cmd.func(createPageMock([createdBoard(null)]), { name: 'My Board' })).rejects.toThrow(CommandExecutionError);
  });

  it('surfaces Pinterest\'s own error message on HTTP failure', async () => {
    const page = createPageMock([{ __httpError: 400, message: 'A board with that name already exists.' }]);
    await expect(cmd.func(page, { name: 'My Board' })).rejects.toThrow('A board with that name already exists.');
  });
});
