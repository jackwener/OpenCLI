import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDownloadNotebooklmInfographicViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDownloadNotebooklmInfographicViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    downloadNotebooklmInfographicViaRpc: mockDownloadNotebooklmInfographicViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-infographic.js';

describe('notebooklm download-infographic', () => {
  const command = getRegistry().get('notebooklm/download/infographic');

  beforeEach(() => {
    mockDownloadNotebooklmInfographicViaRpc.mockReset();
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

  it('downloads the latest completed infographic artifact when artifact id is omitted', async () => {
    mockDownloadNotebooklmInfographicViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'infographic-2',
      artifact_type: 'infographic',
      title: 'Browser Automation Infographic',
      output_path: 'E:\\tmp\\browser-automation.png',
      created_at: '2026-03-31T12:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest.png',
      source: 'rpc+artifact-url',
    });

    const result = await command!.func!({} as any, { output_path: 'E:\\tmp\\browser-automation.png' });

    expect(mockDownloadNotebooklmInfographicViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.png',
      undefined,
    );
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'infographic-2',
        artifact_type: 'infographic',
        output_path: 'E:\\tmp\\browser-automation.png',
      }),
    ]);
  });

  it('passes --artifact-id through to the infographic download helper', async () => {
    mockDownloadNotebooklmInfographicViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'infographic-1',
      artifact_type: 'infographic',
      title: 'Browser Automation Infographic',
      output_path: 'E:\\tmp\\browser-automation.png',
      created_at: '2026-03-30T10:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/specific.png',
      source: 'rpc+artifact-url',
    });

    await command!.func!({} as any, {
      output_path: 'E:\\tmp\\browser-automation.png',
      'artifact-id': 'infographic-1',
    });

    expect(mockDownloadNotebooklmInfographicViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.png',
      'infographic-1',
    );
  });
});
