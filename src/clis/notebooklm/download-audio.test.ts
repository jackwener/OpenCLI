import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDownloadNotebooklmAudioViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDownloadNotebooklmAudioViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    downloadNotebooklmAudioViaRpc: mockDownloadNotebooklmAudioViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-audio.js';

describe('notebooklm download-audio', () => {
  const command = getRegistry().get('notebooklm/download/audio');

  beforeEach(() => {
    mockDownloadNotebooklmAudioViaRpc.mockReset();
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

  it('downloads the latest completed audio artifact when artifact id is omitted', async () => {
    mockDownloadNotebooklmAudioViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'audio-2',
      artifact_type: 'audio',
      title: 'Browser Automation Audio',
      output_path: 'E:\\tmp\\browser-automation.m4a',
      created_at: '2026-03-31T12:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest-audio-dv',
      mime_type: 'audio/mp4',
      source: 'rpc+artifact-url',
    });

    const result = await command!.func!({} as any, { output_path: 'E:\\tmp\\browser-automation.m4a' });

    expect(mockDownloadNotebooklmAudioViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.m4a',
      undefined,
    );
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'audio-2',
        artifact_type: 'audio',
        output_path: 'E:\\tmp\\browser-automation.m4a',
      }),
    ]);
  });

  it('passes --artifact-id through to the audio download helper', async () => {
    mockDownloadNotebooklmAudioViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'audio-1',
      artifact_type: 'audio',
      title: 'Browser Automation Audio',
      output_path: 'E:\\tmp\\browser-automation.m4a',
      created_at: '2026-03-30T10:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest-audio',
      mime_type: 'audio/mp4',
      source: 'rpc+artifact-url',
    });

    await command!.func!({} as any, {
      output_path: 'E:\\tmp\\browser-automation.m4a',
      'artifact-id': 'audio-1',
    });

    expect(mockDownloadNotebooklmAudioViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.m4a',
      'audio-1',
    );
  });
});
