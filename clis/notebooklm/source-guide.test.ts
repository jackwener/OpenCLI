import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListNotebooklmSourcesViaRpc,
  mockListNotebooklmSourcesFromPage,
  mockGetNotebooklmSourceGuideViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockListNotebooklmSourcesViaRpc: vi.fn(),
  mockListNotebooklmSourcesFromPage: vi.fn(),
  mockGetNotebooklmSourceGuideViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    listNotebooklmSourcesViaRpc: mockListNotebooklmSourcesViaRpc,
    listNotebooklmSourcesFromPage: mockListNotebooklmSourcesFromPage,
    getNotebooklmSourceGuideViaRpc: mockGetNotebooklmSourceGuideViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../src/registry.js';
import './source-guide.js';

describe('notebooklm source-guide', () => {
  const command = getRegistry().get('notebooklm/source-guide');

  beforeEach(() => {
    mockListNotebooklmSourcesViaRpc.mockReset();
    mockListNotebooklmSourcesFromPage.mockReset();
    mockGetNotebooklmSourceGuideViaRpc.mockReset();
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

  it('returns source guide for a source matched from rpc source rows', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([
      {
        id: 'src-yt',
        notebook_id: 'nb-demo',
        title: 'Video Source',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
        type: 'youtube',
        type_code: 9,
      },
    ]);
    mockGetNotebooklmSourceGuideViaRpc.mockResolvedValue({
      source_id: 'src-yt',
      notebook_id: 'nb-demo',
      title: 'Video Source',
      type: 'youtube',
      summary: 'Guide summary.',
      keywords: ['AI', 'agents'],
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { source: 'src-yt' });

    expect(result).toEqual([
      {
        source_id: 'src-yt',
        notebook_id: 'nb-demo',
        title: 'Video Source',
        type: 'youtube',
        summary: 'Guide summary.',
        keywords: ['AI', 'agents'],
        source: 'rpc',
      },
    ]);
  });

  it('matches by title from dom rows when rpc source list is unavailable', async () => {
    mockListNotebooklmSourcesViaRpc.mockResolvedValue([]);
    mockListNotebooklmSourcesFromPage.mockResolvedValue([
      {
        id: 'src-1',
        notebook_id: 'nb-demo',
        title: 'Example Source',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'current-page',
      },
    ]);
    mockGetNotebooklmSourceGuideViaRpc.mockResolvedValue({
      source_id: 'src-1',
      notebook_id: 'nb-demo',
      title: 'Example Source',
      type: null,
      summary: 'Guide summary.',
      keywords: ['topic'],
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { source: 'example source' });

    expect(result).toEqual([
      expect.objectContaining({
        source_id: 'src-1',
        title: 'Example Source',
        summary: 'Guide summary.',
      }),
    ]);
  });
});
