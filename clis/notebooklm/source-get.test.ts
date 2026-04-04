import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListNotebooklmSourcesViaRpc,
  mockListNotebooklmSourcesFromPage,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockListNotebooklmSourcesFromPage: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    listNotebooklmSourcesFromPage: mockListNotebooklmSourcesFromPage,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../src/registry.js';
import './source-get.js';

describe('notebooklm source-get', () => {
  const command = getRegistry().get('notebooklm/source-get');

  beforeEach(() => {
    mockListNotebooklmSourcesViaRpc.mockReset();
    mockListNotebooklmSourcesFromPage.mockReset();
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

  it('returns a source by exact id from rpc results', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Release Notes',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'web',
      },
    ]);

    const result = await command!.func!({} as any, { source: 'src-1' });

    expect(result).toEqual([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Release Notes',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'web',
      },
    ]);
    expect(mockListNotebooklmSourcesFromPage).not.toHaveBeenCalled();
  });

  it('falls back to page results and matches by title when rpc is empty', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([]);
    mockListNotebooklmSourcesFromPage.mockResolvedValue([
      {
        id: 'Meeting Notes',
        notebook_id: 'nb-demo',
        title: 'Meeting Notes',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'current-page',
      },
    ]);

    const result = await command!.func!({} as any, { source: 'meeting notes' });

    expect(result).toEqual([
      {
        id: 'Meeting Notes',
        notebook_id: 'nb-demo',
        title: 'Meeting Notes',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'current-page',
      },
    ]);
  });
});
