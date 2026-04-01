import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
  mockWaitForNotebooklmSourcesReadyViaRpc,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
  mockWaitForNotebooklmSourcesReadyViaRpc: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
    waitForNotebooklmSourcesReadyViaRpc: mockWaitForNotebooklmSourcesReadyViaRpc,
  };
});

import { getRegistry } from '../../registry.js';
import './source-wait-for-sources.js';

describe('notebooklm source wait-for-sources', () => {
  const command = getRegistry().get('notebooklm/source/wait-for-sources');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockWaitForNotebooklmSourcesReadyViaRpc.mockReset();

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

  it('waits for multiple comma-separated source ids and returns ready rows in the same order', async () => {
    mockWaitForNotebooklmSourcesReadyViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'doc-1.txt',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'markdown',
        type_code: 8,
        size: 12,
        created_at: null,
        updated_at: null,
        status: 'ready',
        status_code: 2,
      },
      {
        id: 'src-2',
        notebook_id: 'nb-demo',
        title: 'doc-2.txt',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'markdown',
        type_code: 8,
        size: 13,
        created_at: null,
        updated_at: null,
        status: 'ready',
        status_code: 2,
      },
    ]);

    const result = await command!.func!({} as any, {
      'source-ids': 'src-1, src-2',
      timeout: 45,
      'initial-interval': 0.5,
      'max-interval': 5,
    });

    expect(mockWaitForNotebooklmSourcesReadyViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      ['src-1', 'src-2'],
      expect.objectContaining({
        timeout: 45,
        initialInterval: 0.5,
        maxInterval: 5,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({ id: 'src-1', status: 'ready' }),
      expect.objectContaining({ id: 'src-2', status: 'ready' }),
    ]);
  });
});
