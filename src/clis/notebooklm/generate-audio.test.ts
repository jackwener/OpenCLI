import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGenerateNotebooklmAudioViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGenerateNotebooklmAudioViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    generateNotebooklmAudioViaRpc: mockGenerateNotebooklmAudioViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './generate-audio.js';

describe('notebooklm generate-audio', () => {
  const command = getRegistry().get('notebooklm/generate/audio');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGenerateNotebooklmAudioViaRpc.mockReset();
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

  it('submits an audio generation request for the current notebook', async () => {
    mockGenerateNotebooklmAudioViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'audio-gen-1',
      artifact_type: 'audio',
      status: 'pending',
      source: 'rpc+create-artifact',
    });

    const result = await command!.func!({} as any, {});

    expect(mockGenerateNotebooklmAudioViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: false }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        artifact_id: 'audio-gen-1',
        artifact_type: 'audio',
        status: 'pending',
      }),
    ]);
  });

  it('passes the wait flag through to the audio generate helper', async () => {
    mockGenerateNotebooklmAudioViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'audio-gen-2',
      artifact_type: 'audio',
      status: 'completed',
      created_at: '2026-03-31T04:00:00.000Z',
      source: 'rpc+create-artifact+artifact-list',
    });

    await command!.func!({} as any, { wait: true });

    expect(mockGenerateNotebooklmAudioViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: true }),
    );
  });
});
