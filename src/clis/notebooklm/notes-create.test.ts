import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateNotebooklmNoteViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockCreateNotebooklmNoteViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    createNotebooklmNoteViaRpc: mockCreateNotebooklmNoteViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './notes-create.js';

describe('notebooklm notes create', () => {
  const command = getRegistry().get('notebooklm/notes/create');

  beforeEach(() => {
    mockCreateNotebooklmNoteViaRpc.mockReset();
    mockEnsureNotebooklmNotebookBinding.mockReset();
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

  it('creates a note via rpc and returns the created note row', async () => {
    mockCreateNotebooklmNoteViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      id: 'note-created',
      title: '新建笔记',
      content: '这是正文',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      title: '新建笔记',
      content: '这是正文',
    });

    expect(mockCreateNotebooklmNoteViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      '新建笔记',
      '这是正文',
    );
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-created',
        title: '新建笔记',
        content: '这是正文',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });
});
