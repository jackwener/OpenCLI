import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDownloadNotebooklmSlideDeckViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDownloadNotebooklmSlideDeckViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    downloadNotebooklmSlideDeckViaRpc: mockDownloadNotebooklmSlideDeckViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-slide-deck.js';

describe('notebooklm download-slide-deck', () => {
  const command = getRegistry().get('notebooklm/download/slide-deck');

  beforeEach(() => {
    mockDownloadNotebooklmSlideDeckViaRpc.mockReset();
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

  it('downloads the latest completed slide deck as pdf by default', async () => {
    mockDownloadNotebooklmSlideDeckViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'slide-2',
      artifact_type: 'slide_deck',
      title: 'Browser Automation Deck',
      output_path: 'E:\\tmp\\browser-automation.pdf',
      created_at: '2026-03-31T12:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest.pdf',
      download_format: 'pdf',
      source: 'rpc+artifact-url',
    });

    const result = await command!.func!({} as any, { output_path: 'E:\\tmp\\browser-automation.pdf' });

    expect(mockDownloadNotebooklmSlideDeckViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.pdf',
      undefined,
      'pdf',
    );
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'slide-2',
        artifact_type: 'slide_deck',
        output_path: 'E:\\tmp\\browser-automation.pdf',
        download_format: 'pdf',
      }),
    ]);
  });

  it('passes --artifact-id and --output-format through to the slide-deck download helper', async () => {
    mockDownloadNotebooklmSlideDeckViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'slide-1',
      artifact_type: 'slide_deck',
      title: 'Browser Automation Deck',
      output_path: 'E:\\tmp\\browser-automation.pptx',
      created_at: '2026-03-30T10:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      download_url: 'https://example.com/latest.pptx',
      download_format: 'pptx',
      source: 'rpc+artifact-url',
    });

    await command!.func!({} as any, {
      output_path: 'E:\\tmp\\browser-automation.pptx',
      'artifact-id': 'slide-1',
      'output-format': 'pptx',
    });

    expect(mockDownloadNotebooklmSlideDeckViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.pptx',
      'slide-1',
      'pptx',
    );
  });
});
