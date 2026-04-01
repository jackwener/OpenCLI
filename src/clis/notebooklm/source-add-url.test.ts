import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAddNotebooklmUrlSourceViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockAddNotebooklmUrlSourceViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    addNotebooklmUrlSourceViaRpc: mockAddNotebooklmUrlSourceViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-add-url.js';

describe('notebooklm source-add-url', () => {
  const command = getRegistry().get('notebooklm/source-add-url');

  beforeEach(() => {
    mockAddNotebooklmUrlSourceViaRpc.mockReset();
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

  it('adds a url source to the current notebook and returns the created source row', async () => {
    mockAddNotebooklmUrlSourceViaRpc.mockResolvedValue({
      id: 'src-url',
      notebook_id: 'nb-demo',
      title: 'Example Domain',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'web',
      type_code: 5,
      size: 42,
      created_at: '2026-03-31T01:30:00.000Z',
      updated_at: null,
    });

    const result = await command!.func!({} as any, {
      url: 'https://example.com/article',
    });

    expect(mockAddNotebooklmUrlSourceViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      'https://example.com/article',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'src-url',
        title: 'Example Domain',
        type: 'web',
      }),
    ]);
  });
});
