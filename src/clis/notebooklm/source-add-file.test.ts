import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddNotebooklmFileSourceViaUpload,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockAddNotebooklmFileSourceViaUpload: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    addNotebooklmFileSourceViaUpload: mockAddNotebooklmFileSourceViaUpload,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-add-file.js';

describe('notebooklm source add-file', () => {
  const command = getRegistry().get('notebooklm/source/add-file');

  beforeEach(() => {
    mockAddNotebooklmFileSourceViaUpload.mockReset();
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

  it('uploads a local file through the notebooklm ingest path and returns the created source row', async () => {
    mockAddNotebooklmFileSourceViaUpload.mockResolvedValue({
      id: 'src-file',
      notebook_id: 'nb-demo',
      title: 'demo.txt',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: null,
      type_code: null,
      size: 18,
      created_at: null,
      updated_at: null,
      status: 'preparing',
      status_code: 5,
    });

    const result = await command!.func!({} as any, {
      'file-path': 'C:\\temp\\demo.txt',
    });

    expect(mockAddNotebooklmFileSourceViaUpload).toHaveBeenCalledWith(
      expect.anything(),
      'C:\\temp\\demo.txt',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-file',
        title: 'demo.txt',
        status: 'preparing',
        status_code: 5,
      }),
    ]);
  });
});
