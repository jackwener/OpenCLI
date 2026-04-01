import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmHome,
  mockRenameNotebooklmNotebookViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmHome: vi.fn(),
  mockRenameNotebooklmNotebookViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmHome: mockEnsureNotebooklmHome,
    renameNotebooklmNotebookViaRpc: mockRenameNotebooklmNotebookViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './rename.js';

describe('notebooklm rename', () => {
  const command = getRegistry().get('notebooklm/rename');

  beforeEach(() => {
    mockEnsureNotebooklmHome.mockReset();
    mockRenameNotebooklmNotebookViaRpc.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockEnsureNotebooklmHome.mockResolvedValue(undefined);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
  });

  it('renames a notebook via rpc and returns the updated notebook row', async () => {
    mockRenameNotebooklmNotebookViaRpc.mockResolvedValue({
      id: 'nb-demo',
      title: '重命名后的 Notebook',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      is_owner: true,
      created_at: null,
      updated_at: '2026-03-31T09:30:00.000Z',
      emoji: null,
      source_count: 0,
    });

    const result = await command!.func!({} as any, {
      notebook_id: 'nb-demo',
      title: '重命名后的 Notebook',
    });

    expect(mockRenameNotebooklmNotebookViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'nb-demo',
      '重命名后的 Notebook',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'nb-demo',
        title: '重命名后的 Notebook',
        source: 'rpc',
      }),
    ]);
  });
});
