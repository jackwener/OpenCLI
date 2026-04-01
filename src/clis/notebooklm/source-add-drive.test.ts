import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddNotebooklmDriveSourceViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockAddNotebooklmDriveSourceViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    addNotebooklmDriveSourceViaRpc: mockAddNotebooklmDriveSourceViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-add-drive.js';

describe('notebooklm source add-drive', () => {
  const command = getRegistry().get('notebooklm/source/add-drive');

  beforeEach(() => {
    mockAddNotebooklmDriveSourceViaRpc.mockReset();
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
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

  it('adds a Google Drive source using file id, title, and optional mime type', async () => {
    mockAddNotebooklmDriveSourceViaRpc.mockResolvedValue({
      id: 'src-drive',
      notebook_id: 'nb-demo',
      title: 'Shared Spec',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'type-1',
      type_code: 1,
      size: null,
      created_at: '2026-04-01T02:30:00.000Z',
      updated_at: null,
    });

    const result = await command!.func!({} as any, {
      'file-id': '1abcDriveFileIdXYZ',
      title: 'Shared Spec',
      'mime-type': 'application/vnd.google-apps.document',
    });

    expect(mockAddNotebooklmDriveSourceViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      '1abcDriveFileIdXYZ',
      'Shared Spec',
      'application/vnd.google-apps.document',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-drive',
        title: 'Shared Spec',
      }),
    ]);
  });
});
