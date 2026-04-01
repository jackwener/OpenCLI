import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListNotebooklmNotesFromPage, mockListNotebooklmNotesViaRpc, mockGetNotebooklmPageState, mockRequireNotebooklmSession } = vi.hoisted(() => ({
  mockListNotebooklmNotesFromPage: vi.fn(),
  mockListNotebooklmNotesViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmNotesFromPage: mockListNotebooklmNotesFromPage,
    listNotebooklmNotesViaRpc: mockListNotebooklmNotesViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './note-list.js';

describe('notebooklm note-list', () => {
  const command = getRegistry().get('notebooklm/note-list');

  beforeEach(() => {
    mockListNotebooklmNotesFromPage.mockReset();
    mockListNotebooklmNotesViaRpc.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
    mockListNotebooklmNotesViaRpc.mockResolvedValue([]);
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

  it('lists notebook notes from the Studio panel', async () => {
    mockListNotebooklmNotesFromPage.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        created_at: '6 分钟前',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-list',
      },
    ]);

    const result = await command!.func!({} as any, {});

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        created_at: '6 分钟前',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-list',
      },
    ]);
  });

  it('falls back to rpc when the Studio panel dom is empty', async () => {
    mockListNotebooklmNotesFromPage.mockResolvedValue([]);
    mockListNotebooklmNotesViaRpc.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        id: 'note-rpc-1',
        title: '新建笔记',
        content: '',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);

    const result = await command!.func!({} as any, {});

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-rpc-1',
        title: '新建笔记',
        content: '',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
    expect(mockListNotebooklmNotesViaRpc).toHaveBeenCalledTimes(1);
  });
});
