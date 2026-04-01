import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockListNotebooklmSourcesViaRpc,
  mockRenameNotebooklmSourceViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockRenameNotebooklmSourceViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    renameNotebooklmSourceViaRpc: mockRenameNotebooklmSourceViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-rename.js';

describe('notebooklm source rename', () => {
  const command = getRegistry().get('notebooklm/source/rename');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockListNotebooklmSourcesViaRpc.mockReset();
    mockRenameNotebooklmSourceViaRpc.mockReset();
    mockRequireNotebooklmSession.mockReset();

    mockEnsureNotebooklmNotebookBinding.mockResolvedValue(false);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
    mockGetNotebooklmPageState.mockResolvedValue({
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      title: 'Browser Automation',
      hostname: 'notebooklm.google.com',
      kind: 'notebook',
      notebookId: 'nb-demo',
      loginRequired: false,
      notebookCount: 1,
    });
  });

  it('renames a source via rpc when --source-id is provided', async () => {
    mockRenameNotebooklmSourceViaRpc.mockResolvedValue({
      id: 'src-1',
      notebook_id: 'nb-demo',
      title: '重命名后的来源',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'web',
      type_code: 5,
      size: 42,
      created_at: '2026-03-31T01:30:00.000Z',
      updated_at: '2026-03-31T01:40:00.000Z',
    });

    const result = await command!.func!({} as any, {
      'source-id': 'src-1',
      title: '重命名后的来源',
    });

    expect(mockRenameNotebooklmSourceViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'src-1',
      '重命名后的来源',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-1',
        title: '重命名后的来源',
        type: 'web',
      }),
    ]);
  });

  it('falls back to a unique exact source title when --source-id is omitted', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Example Domain',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'web',
        type_code: 5,
        size: 42,
        created_at: '2026-03-31T01:30:00.000Z',
        updated_at: '2026-03-31T01:40:00.000Z',
      },
    ]);
    mockRenameNotebooklmSourceViaRpc.mockResolvedValue({
      id: 'src-1',
      notebook_id: 'nb-demo',
      title: 'Example Domain Updated',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'web',
      type_code: 5,
      size: 42,
      created_at: '2026-03-31T01:30:00.000Z',
      updated_at: '2026-03-31T01:45:00.000Z',
    });

    const result = await command!.func!({} as any, {
      source: 'Example Domain',
      title: 'Example Domain Updated',
    });

    expect(mockRenameNotebooklmSourceViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'src-1',
      'Example Domain Updated',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-1',
        title: 'Example Domain Updated',
      }),
    ]);
  });
});
