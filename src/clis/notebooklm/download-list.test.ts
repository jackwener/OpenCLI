import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockListNotebooklmDownloadArtifactsViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockListNotebooklmDownloadArtifactsViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmDownloadArtifactsViaRpc: mockListNotebooklmDownloadArtifactsViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-list.js';

describe('notebooklm download-list', () => {
  const command = getRegistry().get('notebooklm/download/list');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockListNotebooklmDownloadArtifactsViaRpc.mockReset();
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

  it('lists downloadable artifacts for the current notebook', async () => {
    mockListNotebooklmDownloadArtifactsViaRpc.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        artifact_id: 'slide-1',
        artifact_type: 'slide_deck',
        status: 'completed',
        title: 'Browser Automation Deck',
        created_at: '2026-03-31T12:00:00.000Z',
        download_variants: ['pdf', 'pptx'],
        source: 'rpc+artifact-list',
      },
    ]);

    const result = await command!.func!({} as any, {});

    expect(mockListNotebooklmDownloadArtifactsViaRpc).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'slide-1',
        artifact_type: 'slide_deck',
        download_variants: ['pdf', 'pptx'],
      }),
    ]);
  });
});
