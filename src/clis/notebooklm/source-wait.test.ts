import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
  mockWaitForNotebooklmSourceReadyViaRpc,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
  mockWaitForNotebooklmSourceReadyViaRpc: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
    waitForNotebooklmSourceReadyViaRpc: mockWaitForNotebooklmSourceReadyViaRpc,
  };
});

import { getRegistry } from '../../registry.js';
import './source-wait.js';

describe('notebooklm source wait', () => {
  const command = getRegistry().get('notebooklm/source/wait');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockWaitForNotebooklmSourceReadyViaRpc.mockReset();

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

  it('waits for a single source id by delegating to the shared wait core', async () => {
    mockWaitForNotebooklmSourceReadyViaRpc.mockResolvedValue({
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
    });

    const result = await command!.func!({} as any, {
      'source-id': 'src-1',
      timeout: 30,
      'initial-interval': 0.25,
      'max-interval': 3,
    });

    expect(mockWaitForNotebooklmSourceReadyViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'src-1',
      expect.objectContaining({
        timeout: 30,
        initialInterval: 0.25,
        maxInterval: 3,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-1',
        status: 'ready',
      }),
    ]);
  });
});
