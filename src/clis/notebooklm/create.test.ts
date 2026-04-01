import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateNotebooklmNotebookViaRpc,
  mockEnsureNotebooklmHome,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockCreateNotebooklmNotebookViaRpc: vi.fn(),
  mockEnsureNotebooklmHome: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    createNotebooklmNotebookViaRpc: mockCreateNotebooklmNotebookViaRpc,
    ensureNotebooklmHome: mockEnsureNotebooklmHome,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './create.js';

describe('notebooklm create', () => {
  const command = getRegistry().get('notebooklm/create');

  beforeEach(() => {
    mockCreateNotebooklmNotebookViaRpc.mockReset();
    mockEnsureNotebooklmHome.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockEnsureNotebooklmHome.mockResolvedValue(undefined);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
  });

  it('creates a new notebook via rpc and returns the created notebook row', async () => {
    mockCreateNotebooklmNotebookViaRpc.mockResolvedValue({
      id: 'nb-created',
      title: '新建 Notebook',
      url: 'https://notebooklm.google.com/notebook/nb-created',
      source: 'rpc',
      is_owner: true,
      created_at: '2026-03-31T09:12:00.000Z',
      updated_at: '2026-03-31T09:12:00.000Z',
      emoji: null,
      source_count: 0,
    });

    const result = await command!.func!({} as any, { title: '新建 Notebook' });

    expect(mockCreateNotebooklmNotebookViaRpc).toHaveBeenCalledWith(expect.anything(), '新建 Notebook');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'nb-created',
        title: '新建 Notebook',
        source: 'rpc',
      }),
    ]);
  });
});
