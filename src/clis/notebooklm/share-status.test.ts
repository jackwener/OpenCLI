import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetNotebooklmPageState,
  mockGetNotebooklmShareStatusViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockGetNotebooklmPageState: vi.fn(),
  mockGetNotebooklmShareStatusViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    getNotebooklmShareStatusViaRpc: mockGetNotebooklmShareStatusViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './share-status.js';

describe('notebooklm share-status', () => {
  const command = getRegistry().get('notebooklm/share-status');

  beforeEach(() => {
    mockGetNotebooklmPageState.mockReset();
    mockGetNotebooklmShareStatusViaRpc.mockReset();
    mockRequireNotebooklmSession.mockReset();
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

  it('returns the current notebook share status via rpc', async () => {
    mockGetNotebooklmShareStatusViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      is_public: false,
      access: 'restricted',
      view_level: 'full',
      share_url: null,
      shared_user_count: 1,
      shared_users: [
        {
          email: 'user@example.com',
          permission: 'viewer',
          display_name: 'User Example',
          avatar_url: null,
        },
      ],
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {});

    expect(mockGetNotebooklmShareStatusViaRpc).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        access: 'restricted',
        source: 'rpc',
      }),
    ]);
  });
});
