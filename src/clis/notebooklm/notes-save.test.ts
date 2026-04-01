import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../../errors.js';

const {
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
  mockSaveNotebooklmVisibleNoteViaRpc,
} = vi.hoisted(() => ({
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
  mockSaveNotebooklmVisibleNoteViaRpc: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
    saveNotebooklmVisibleNoteViaRpc: mockSaveNotebooklmVisibleNoteViaRpc,
  };
});

import { getRegistry } from '../../registry.js';
import './notes-save.js';

describe('notebooklm notes-save', () => {
  const command = getRegistry().get('notebooklm/notes-save');

  beforeEach(() => {
    mockGetNotebooklmPageState.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockSaveNotebooklmVisibleNoteViaRpc.mockReset();
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

  it('saves the currently visible note editor content through rpc and returns the saved row', async () => {
    mockSaveNotebooklmVisibleNoteViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      id: 'note-1',
      title: '新建笔记',
      content: '第一段\n第二段',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {});

    expect(mockSaveNotebooklmVisibleNoteViaRpc).toHaveBeenCalledWith(expect.anything());
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        content: '第一段\n第二段',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('passes --note-id through to the rpc save helper', async () => {
    mockSaveNotebooklmVisibleNoteViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      id: 'note-2',
      title: '新建笔记',
      content: '第二条正文',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { 'note-id': 'note-2' });

    expect(mockSaveNotebooklmVisibleNoteViaRpc).toHaveBeenCalledWith(expect.anything(), 'note-2');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-2',
        title: '新建笔记',
        content: '第二条正文',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('reports a missing visible editor explicitly when --note-id is provided', async () => {
    mockSaveNotebooklmVisibleNoteViaRpc.mockResolvedValue(null);

    await expect(command!.func!({} as any, { 'note-id': 'note-2' })).rejects.toMatchObject({
      message: expect.stringMatching(/note-2/),
      hint: expect.stringMatching(/visible .*note editor/i),
    } satisfies Partial<CliError>);
  });
});
