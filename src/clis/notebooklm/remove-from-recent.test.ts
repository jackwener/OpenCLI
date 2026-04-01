import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmHome,
  mockRemoveNotebooklmFromRecentViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmHome: vi.fn(),
  mockRemoveNotebooklmFromRecentViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmHome: mockEnsureNotebooklmHome,
    removeNotebooklmFromRecentViaRpc: mockRemoveNotebooklmFromRecentViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './remove-from-recent.js';

describe('notebooklm remove-from-recent', () => {
  const command = getRegistry().get('notebooklm/remove-from-recent');

  beforeEach(() => {
    mockEnsureNotebooklmHome.mockReset();
    mockRemoveNotebooklmFromRecentViaRpc.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockEnsureNotebooklmHome.mockResolvedValue(undefined);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
    mockRemoveNotebooklmFromRecentViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      removed_from_recent: true,
      source: 'rpc',
    });
  });

  it('removes a notebook from the recent list via rpc', async () => {
    const result = await command!.func!({} as any, { notebook_id: 'nb-demo' });

    expect(mockRemoveNotebooklmFromRecentViaRpc).toHaveBeenCalledWith(expect.anything(), 'nb-demo');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        removed_from_recent: true,
        source: 'rpc',
      },
    ]);
  });
});
