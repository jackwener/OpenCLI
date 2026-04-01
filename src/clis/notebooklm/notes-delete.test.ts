import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteNotebooklmNoteViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockListNotebooklmNotesViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDeleteNotebooklmNoteViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockListNotebooklmNotesViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    deleteNotebooklmNoteViaRpc: mockDeleteNotebooklmNoteViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmNotesViaRpc: mockListNotebooklmNotesViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './notes-delete.js';

describe('notebooklm notes delete', () => {
  const command = getRegistry().get('notebooklm/notes/delete');

  beforeEach(() => {
    mockDeleteNotebooklmNoteViaRpc.mockReset();
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockListNotebooklmNotesViaRpc.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockEnsureNotebooklmNotebookBinding.mockResolvedValue(false);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
    mockListNotebooklmNotesViaRpc.mockResolvedValue([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        content: '',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
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

  it('deletes a note via rpc when --note-id is provided', async () => {
    mockDeleteNotebooklmNoteViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      note_id: 'note-1',
      deleted: true,
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      'note-id': 'note-1',
    });

    expect(mockDeleteNotebooklmNoteViaRpc).toHaveBeenCalledWith(expect.anything(), 'note-1');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        note_id: 'note-1',
        deleted: true,
        source: 'rpc',
      },
    ]);
  });
});
