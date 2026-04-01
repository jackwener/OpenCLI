import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGenerateNotebooklmSlideDeckViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGenerateNotebooklmSlideDeckViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    generateNotebooklmSlideDeckViaRpc: mockGenerateNotebooklmSlideDeckViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './generate-slide-deck.js';

describe('notebooklm generate-slide-deck', () => {
  const command = getRegistry().get('notebooklm/generate/slide-deck');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGenerateNotebooklmSlideDeckViaRpc.mockReset();
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

  it('submits a slide-deck generation request for the current notebook', async () => {
    mockGenerateNotebooklmSlideDeckViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'deck-gen-1',
      artifact_type: 'slide_deck',
      status: 'pending',
      source: 'rpc+create-artifact',
    });

    const result = await command!.func!({} as any, {});

    expect(mockGenerateNotebooklmSlideDeckViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: false }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        artifact_id: 'deck-gen-1',
        artifact_type: 'slide_deck',
        status: 'pending',
      }),
    ]);
  });

  it('passes the wait flag through to the slide-deck generate helper', async () => {
    mockGenerateNotebooklmSlideDeckViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'deck-gen-2',
      artifact_type: 'slide_deck',
      status: 'completed',
      created_at: '2026-03-31T04:15:00.000Z',
      source: 'rpc+create-artifact+artifact-list',
    });

    await command!.func!({} as any, { wait: true });

    expect(mockGenerateNotebooklmSlideDeckViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: true }),
    );
  });
});
