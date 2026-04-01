import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDownloadNotebooklmVideoViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDownloadNotebooklmVideoViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    downloadNotebooklmVideoViaRpc: mockDownloadNotebooklmVideoViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-video.js';

describe('notebooklm download-video', () => {
  const command = getRegistry().get('notebooklm/download/video');

  beforeEach(() => {
    mockDownloadNotebooklmVideoViaRpc.mockReset();
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

  it('downloads the latest completed video artifact when artifact id is omitted', async () => {
    mockDownloadNotebooklmVideoViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'video-2',
      artifact_type: 'video',
      title: 'Browser Automation Video',
      output_path: 'E:\\tmp\\browser-automation.mp4',
      created_at: '2026-03-31T12:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest-video',
      mime_type: 'video/mp4',
      source: 'rpc+artifact-url',
    });

    const result = await command!.func!({} as any, { output_path: 'E:\\tmp\\browser-automation.mp4' });

    expect(mockDownloadNotebooklmVideoViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.mp4',
      undefined,
    );
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'video-2',
        artifact_type: 'video',
        output_path: 'E:\\tmp\\browser-automation.mp4',
      }),
    ]);
  });

  it('passes --artifact-id through to the video download helper', async () => {
    mockDownloadNotebooklmVideoViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'video-1',
      artifact_type: 'video',
      title: 'Browser Automation Video',
      output_path: 'E:\\tmp\\browser-automation.mp4',
      created_at: '2026-03-30T10:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest-video-dv',
      mime_type: 'video/mp4',
      source: 'rpc+artifact-url',
    });

    await command!.func!({} as any, {
      output_path: 'E:\\tmp\\browser-automation.mp4',
      'artifact-id': 'video-1',
    });

    expect(mockDownloadNotebooklmVideoViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.mp4',
      'video-1',
    );
  });
});
