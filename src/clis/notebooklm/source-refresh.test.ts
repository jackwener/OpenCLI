import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockListNotebooklmSourcesViaRpc,
  mockRefreshNotebooklmSourceViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockRefreshNotebooklmSourceViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    refreshNotebooklmSourceViaRpc: mockRefreshNotebooklmSourceViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-refresh.js';

describe('notebooklm source refresh', () => {
  const command = getRegistry().get('notebooklm/source/refresh');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockListNotebooklmSourcesViaRpc.mockReset();
    mockRefreshNotebooklmSourceViaRpc.mockReset();
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

  it('refreshes a source via rpc when --source-id is provided', async () => {
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
    mockRefreshNotebooklmSourceViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      source_id: 'src-1',
      refreshed: true,
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      'source-id': 'src-1',
    });

    expect(mockRefreshNotebooklmSourceViaRpc).toHaveBeenCalledWith(expect.anything(), 'src-1');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        source_id: 'src-1',
        refreshed: true,
        source: 'rpc',
      },
    ]);
  });
});
