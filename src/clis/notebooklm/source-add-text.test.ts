import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddNotebooklmTextSourceViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockAddNotebooklmTextSourceViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    addNotebooklmTextSourceViaRpc: mockAddNotebooklmTextSourceViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-add-text.js';

describe('notebooklm source-add-text', () => {
  const command = getRegistry().get('notebooklm/source-add-text');

  beforeEach(() => {
    mockAddNotebooklmTextSourceViaRpc.mockReset();
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

  it('adds pasted text to the current notebook and returns the created source row', async () => {
    mockAddNotebooklmTextSourceViaRpc.mockResolvedValue({
      id: 'src-created',
      notebook_id: 'nb-demo',
      title: '贴入内容',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'pasted-text',
      type_code: 8,
      size: 12,
      created_at: '2026-03-30T12:03:03.855Z',
      updated_at: null,
    });

    const result = await command!.func!({} as any, {
      title: '贴入内容',
      content: '第一段\n第二段',
    });

    expect(mockAddNotebooklmTextSourceViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      '贴入内容',
      '第一段\n第二段',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-created',
        title: '贴入内容',
        type: 'pasted-text',
      }),
    ]);
  });
});
