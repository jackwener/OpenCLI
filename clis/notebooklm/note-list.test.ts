import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListNotebooklmNotesFromPage, mockGetNotebooklmPageState, mockRequireNotebooklmSession } = vi.hoisted(() => ({
  mockListNotebooklmNotesFromPage: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmNotesFromPage: mockListNotebooklmNotesFromPage,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './note-list.js';

describe('notebooklm note-list', () => {
  const command = getRegistry().get('notebooklm/note-list');

  beforeEach(() => {
    mockListNotebooklmNotesFromPage.mockReset();
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

  it('lists notebook notes from the Studio panel', async () => {
    mockListNotebooklmNotesFromPage.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
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
        title: '新建笔记',
        created_at: '6 分钟前',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-list',
      },
    ]);
  });
});
