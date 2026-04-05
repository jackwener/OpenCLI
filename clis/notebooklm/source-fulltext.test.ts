import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListNotebooklmSourcesViaRpc,
  mockListNotebooklmSourcesFromPage,
  mockGetNotebooklmSourceFulltextViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockListNotebooklmSourcesFromPage: vi.fn(),
  mockGetNotebooklmSourceFulltextViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    listNotebooklmSourcesFromPage: mockListNotebooklmSourcesFromPage,
    getNotebooklmSourceFulltextViaRpc: mockGetNotebooklmSourceFulltextViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '@jackwener/opencli/registry';
import './source-fulltext.js';

describe('notebooklm source-fulltext', () => {
  const command = getRegistry().get('notebooklm/source-fulltext');

  beforeEach(() => {
    mockListNotebooklmSourcesViaRpc.mockReset();
    mockListNotebooklmSourcesFromPage.mockReset();
    mockGetNotebooklmSourceFulltextViaRpc.mockReset();
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

  it('returns fulltext for a source matched from rpc source rows', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: '粘贴的文字',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'pasted-text',
      },
    ]);
    mockGetNotebooklmSourceFulltextViaRpc.mockResolvedValue({
      source_id: 'src-1',
      notebook_id: 'nb-demo',
      title: '粘贴的文字',
      kind: 'generated-text',
      content: '第一段\n第二段',
      char_count: 7,
      url: 'https://example.com/source',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { source: 'src-1' });

    expect(result).toEqual([
      {
        source_id: 'src-1',
        notebook_id: 'nb-demo',
        title: '粘贴的文字',
        kind: 'generated-text',
        content: '第一段\n第二段',
        char_count: 7,
        url: 'https://example.com/source',
        source: 'rpc',
      },
    ]);
  });

  it('matches by title from dom rows when rpc source list is unavailable', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([]);
    mockListNotebooklmSourcesFromPage.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: '粘贴的文字',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'current-page',
      },
    ]);
    mockGetNotebooklmSourceFulltextViaRpc.mockResolvedValue({
      source_id: 'src-1',
      notebook_id: 'nb-demo',
      title: '粘贴的文字',
      kind: 'generated-text',
      content: '第一段\n第二段',
      char_count: 7,
      url: 'https://example.com/source',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { source: '粘贴的文字' });

    expect(result).toEqual([
      expect.objectContaining({
        source_id: 'src-1',
        title: '粘贴的文字',
        content: '第一段\n第二段',
      }),
    ]);
  });
});
