import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRenameNotebooklmNoteViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRenameNotebooklmNoteViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    renameNotebooklmNoteViaRpc: mockRenameNotebooklmNoteViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './notes-rename.js';

describe('notebooklm notes rename', () => {
  const command = getRegistry().get('notebooklm/notes/rename');

  it('keeps the new title as the only positional argument so --note-id stays callable', () => {
    expect(command?.args).toEqual([
      expect.objectContaining({
        name: 'title',
        positional: true,
        required: true,
      }),
      expect.objectContaining({
        name: 'note',
      }),
      expect.objectContaining({
        name: 'note-id',
      }),
    ]);
    expect(command?.args?.[1]?.positional).not.toBe(true);
    expect(command?.args?.[2]?.positional).not.toBe(true);
  });

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockRenameNotebooklmNoteViaRpc.mockReset();
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

  it('renames a note via rpc when --note-id is provided', async () => {
    mockRenameNotebooklmNoteViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      id: 'note-1',
      title: '重命名后的笔记',
      content: '原正文',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      'note-id': 'note-1',
      title: '重命名后的笔记',
    });

    expect(mockRenameNotebooklmNoteViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'note-1',
      '重命名后的笔记',
    );
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '重命名后的笔记',
        content: '原正文',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });
});
