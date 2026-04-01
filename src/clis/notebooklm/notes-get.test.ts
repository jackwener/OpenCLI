import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListNotebooklmNotesFromPage,
  mockListNotebooklmNotesViaRpc,
  mockReadNotebooklmVisibleNoteFromPage,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockListNotebooklmNotesFromPage: vi.fn(),
  mockListNotebooklmNotesViaRpc: vi.fn(),
  mockReadNotebooklmVisibleNoteFromPage: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    listNotebooklmNotesFromPage: mockListNotebooklmNotesFromPage,
    listNotebooklmNotesViaRpc: mockListNotebooklmNotesViaRpc,
    readNotebooklmVisibleNoteFromPage: mockReadNotebooklmVisibleNoteFromPage,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import { CliError } from '../../errors.js';
import './notes-get.js';

describe('notebooklm notes-get', () => {
  const command = getRegistry().get('notebooklm/notes-get');

  beforeEach(() => {
    mockListNotebooklmNotesFromPage.mockReset();
    mockListNotebooklmNotesViaRpc.mockReset();
    mockReadNotebooklmVisibleNoteFromPage.mockReset();
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

  it('returns a note directly by rpc id when --note-id is provided', async () => {
    mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue(null);
    mockListNotebooklmNotesViaRpc.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        content: '第一段\\n第二段',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);

    const result = await command!.func!({} as any, { 'note-id': 'note-1' });

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        content: '第一段\\n第二段',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('reports a missing note id explicitly', async () => {
    mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue(null);
    mockListNotebooklmNotesViaRpc.mockResolvedValue([]);

    await expect(command!.func!({} as any, { 'note-id': 'missing-note' })).rejects.toMatchObject({
      message: expect.stringMatching(/missing-note/),
      hint: expect.stringMatching(/No NotebookLM note with id/i),
    } satisfies Partial<CliError>);
  });

  it('returns the currently visible note editor content when the title matches', async () => {
    mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue({
      notebook_id: 'nb-demo',
      title: '新建笔记',
      content: '第一段\\n第二段',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'studio-editor',
    });

    const result = await command!.func!({} as any, { note: '新建笔记' });

    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        title: '新建笔记',
        content: '第一段\\n第二段',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-editor',
      },
    ]);
  });

  it('explains the current visible-note limitation when the target note is listed but not open', async () => {
    mockReadNotebooklmVisibleNoteFromPage.mockResolvedValue(null);
    mockListNotebooklmNotesFromPage.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        title: '新建笔记',
        created_at: '6 分钟前',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-list',
      },
    ]);

    await expect(command!.func!({} as any, { note: '新建笔记' })).rejects.toMatchObject({
      hint: expect.stringMatching(/currently reads note content only from the visible note editor/i),
    } satisfies Partial<CliError>);
  });
});
