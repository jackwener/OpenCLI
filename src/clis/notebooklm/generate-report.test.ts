import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGenerateNotebooklmReportViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGenerateNotebooklmReportViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    generateNotebooklmReportViaRpc: mockGenerateNotebooklmReportViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './generate-report.js';

describe('notebooklm generate-report', () => {
  const command = getRegistry().get('notebooklm/generate/report');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGenerateNotebooklmReportViaRpc.mockReset();
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

  it('submits a report generation request for the current notebook', async () => {
    mockGenerateNotebooklmReportViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'report-gen-1',
      artifact_type: 'report',
      status: 'pending',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc+create-artifact',
    });

    const result = await command!.func!({} as any, {});

    expect(mockGenerateNotebooklmReportViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: false }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        artifact_id: 'report-gen-1',
        artifact_type: 'report',
        status: 'pending',
      }),
    ]);
  });

  it('passes the wait flag through to the generate helper', async () => {
    mockGenerateNotebooklmReportViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'report-gen-2',
      artifact_type: 'report',
      status: 'completed',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc+create-artifact+artifact-list',
    });

    await command!.func!({} as any, { wait: true });

    expect(mockGenerateNotebooklmReportViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: true }),
    );
  });
});
