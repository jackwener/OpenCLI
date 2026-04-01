import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDeleteNotebooklmSourceViaRpc,
  mockEnsureNotebooklmNotebookBinding,
  mockGetNotebooklmPageState,
  mockListNotebooklmSourcesViaRpc,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDeleteNotebooklmSourceViaRpc: vi.fn(),
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    deleteNotebooklmSourceViaRpc: mockDeleteNotebooklmSourceViaRpc,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './source-delete.js';

describe('notebooklm source delete', () => {
  const command = getRegistry().get('notebooklm/source/delete');

  beforeEach(() => {
    mockDeleteNotebooklmSourceViaRpc.mockReset();
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGetNotebooklmPageState.mockReset();
    mockListNotebooklmSourcesViaRpc.mockReset();
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

  it('deletes a source via rpc when --source-id is provided', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Example Domain',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'web',
        type_code: 5,
        size: 42,
        created_at: '2026-03-31T01:30:00.000Z',
        updated_at: '2026-03-31T01:40:00.000Z',
      },
    ]);
    mockDeleteNotebooklmSourceViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      source_id: 'src-1',
      deleted: true,
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      'source-id': 'src-1',
    });

    expect(mockDeleteNotebooklmSourceViaRpc).toHaveBeenCalledWith(expect.anything(), 'src-1');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        source_id: 'src-1',
        deleted: true,
        source: 'rpc',
      },
    ]);
  });

  it('falls back to a unique exact source title when --source-id is omitted', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Example Domain',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'web',
        type_code: 5,
        size: 42,
        created_at: '2026-03-31T01:30:00.000Z',
        updated_at: '2026-03-31T01:40:00.000Z',
      },
    ]);
    mockDeleteNotebooklmSourceViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      source_id: 'src-1',
      deleted: true,
      source: 'rpc',
    });

    const result = await command!.func!({} as any, {
      source: 'Example Domain',
    });

    expect(mockDeleteNotebooklmSourceViaRpc).toHaveBeenCalledWith(expect.anything(), 'src-1');
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        source_id: 'src-1',
        deleted: true,
        source: 'rpc',
      },
    ]);
  });
});
