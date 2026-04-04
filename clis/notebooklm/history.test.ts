import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListNotebooklmHistoryViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockListNotebooklmHistoryViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmHistoryViaRpc: mockListNotebooklmHistoryViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../src/registry.js';
import './history.js';

describe('notebooklm history', () => {
  const history = getRegistry().get('notebooklm/history');

  beforeEach(() => {
    mockListNotebooklmHistoryViaRpc.mockReset();
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

  it('lists notebook history threads from the browser rpc', async () => {
    mockListNotebooklmHistoryViaRpc.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        thread_id: '28e0f2cb-4591-45a3-a661-7653666f7c78',
        item_count: 0,
        preview: 'Summarize this notebook',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);

    const result = await history!.func!({} as any, {});

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        thread_id: '28e0f2cb-4591-45a3-a661-7653666f7c78',
        item_count: 0,
        preview: 'Summarize this notebook',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });
});
