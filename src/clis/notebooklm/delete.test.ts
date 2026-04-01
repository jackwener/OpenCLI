import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteNotebooklmNotebookViaRpc,
  mockEnsureNotebooklmHome,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDeleteNotebooklmNotebookViaRpc: vi.fn(),
  mockEnsureNotebooklmHome: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    deleteNotebooklmNotebookViaRpc: mockDeleteNotebooklmNotebookViaRpc,
    ensureNotebooklmHome: mockEnsureNotebooklmHome,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './delete.js';

describe('notebooklm delete', () => {
  const command = getRegistry().get('notebooklm/delete');

  beforeEach(() => {
    mockDeleteNotebooklmNotebookViaRpc.mockReset();
    mockEnsureNotebooklmHome.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockDeleteNotebooklmNotebookViaRpc.mockResolvedValue({
      notebook_id: 'nb-delete',
      deleted: true,
      source: 'rpc',
    });
    mockEnsureNotebooklmHome.mockResolvedValue(undefined);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
  });

  it('deletes a notebook via rpc and returns the mutation result', async () => {
    const result = await command!.func!({} as any, { notebook_id: 'nb-delete' });

    expect(mockDeleteNotebooklmNotebookViaRpc).toHaveBeenCalledWith(expect.anything(), 'nb-delete');
    expect(result).toEqual([
      {
        notebook_id: 'nb-delete',
        deleted: true,
        source: 'rpc',
      },
    ]);
  });
});
