import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDownloadNotebooklmReportViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDownloadNotebooklmReportViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    downloadNotebooklmReportViaRpc: mockDownloadNotebooklmReportViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './download-report.js';

describe('notebooklm download-report', () => {
  const command = getRegistry().get('notebooklm/download/report');

  beforeEach(() => {
    mockDownloadNotebooklmReportViaRpc.mockReset();
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

  it('downloads the latest completed report when artifact id is omitted', async () => {
    mockDownloadNotebooklmReportViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'report-2',
      title: 'Study Guide: Browser Automation',
      kind: 'report',
      output_path: 'E:\\tmp\\browser-automation.md',
      created_at: '2026-03-31T12:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { output_path: 'E:\\tmp\\browser-automation.md' });

    expect(mockDownloadNotebooklmReportViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\browser-automation.md',
      undefined,
    );
    expect(result).toEqual([
      expect.objectContaining({
        artifact_id: 'report-2',
        title: 'Study Guide: Browser Automation',
        output_path: 'E:\\tmp\\browser-automation.md',
      }),
    ]);
  });

  it('passes --artifact-id through to the report download helper', async () => {
    mockDownloadNotebooklmReportViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'report-1',
      title: 'Briefing Doc: Browser Automation',
      kind: 'report',
      output_path: 'E:\\tmp\\briefing.md',
      created_at: '2026-03-30T10:00:00.000Z',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    await command!.func!({} as any, {
      output_path: 'E:\\tmp\\briefing.md',
      'artifact-id': 'report-1',
    });

    expect(mockDownloadNotebooklmReportViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'E:\\tmp\\briefing.md',
      'report-1',
    );
  });
});
