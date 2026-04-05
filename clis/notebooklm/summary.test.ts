import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadNotebooklmSummaryFromPage,
  mockGetNotebooklmSummaryViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockReadNotebooklmSummaryFromPage: vi.fn(),
  mockGetNotebooklmSummaryViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    readNotebooklmSummaryFromPage: mockReadNotebooklmSummaryFromPage,
    getNotebooklmSummaryViaRpc: mockGetNotebooklmSummaryViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '@jackwener/opencli/registry';
import './summary.js';

describe('notebooklm summary', () => {
  const command = getRegistry().get('notebooklm/summary');

  beforeEach(() => {
    mockReadNotebooklmSummaryFromPage.mockReset();
    mockGetNotebooklmSummaryViaRpc.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockRequireNotebooklmSession.mockReset();
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

  it('returns the current notebook summary from the visible page first', async () => {
    mockReadNotebooklmSummaryFromPage.mockResolvedValue({
      notebook_id: 'nb-demo',
      title: 'Browser Automation',
      summary: 'A concise notebook summary.',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'summary-dom',
    });

    const result = await command!.func!({} as any, {});

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        title: 'Browser Automation',
        summary: 'A concise notebook summary.',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'summary-dom',
      },
    ]);
    expect(mockGetNotebooklmSummaryViaRpc).not.toHaveBeenCalled();
  });

  it('falls back to rpc summary extraction when no visible summary block is found', async () => {
    mockReadNotebooklmSummaryFromPage.mockResolvedValue(null);
    mockGetNotebooklmSummaryViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      title: 'Browser Automation',
      summary: 'Summary recovered from rpc.',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {});

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        title: 'Browser Automation',
        summary: 'Summary recovered from rpc.',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });
});
