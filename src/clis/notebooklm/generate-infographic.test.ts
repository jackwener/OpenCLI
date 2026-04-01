import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnsureNotebooklmNotebookBinding,
  mockGenerateNotebooklmInfographicViaRpc,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockEnsureNotebooklmNotebookBinding: vi.fn(),
  mockGenerateNotebooklmInfographicViaRpc: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    ensureNotebooklmNotebookBinding: mockEnsureNotebooklmNotebookBinding,
    generateNotebooklmInfographicViaRpc: mockGenerateNotebooklmInfographicViaRpc,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './generate-infographic.js';

describe('notebooklm generate-infographic', () => {
  const command = getRegistry().get('notebooklm/generate/infographic');

  beforeEach(() => {
    mockEnsureNotebooklmNotebookBinding.mockReset();
    mockGenerateNotebooklmInfographicViaRpc.mockReset();
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

  it('submits an infographic generation request for the current notebook', async () => {
    mockGenerateNotebooklmInfographicViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'infographic-gen-1',
      artifact_type: 'infographic',
      status: 'pending',
      source: 'rpc+create-artifact',
    });

    const result = await command!.func!({} as any, {});

    expect(mockGenerateNotebooklmInfographicViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wait: false }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        artifact_id: 'infographic-gen-1',
        artifact_type: 'infographic',
        status: 'pending',
      }),
    ]);
  });

  it('passes infographic options through to the generate helper', async () => {
    mockGenerateNotebooklmInfographicViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      artifact_id: 'infographic-gen-2',
      artifact_type: 'infographic',
      status: 'completed',
      source: 'rpc+create-artifact+artifact-list',
    });

    await command!.func!({} as any, {
      wait: true,
      instructions: 'Focus on performance bottlenecks',
      orientation: 'portrait',
      detail: 'detailed',
      style: 'scientific',
    });

    expect(mockGenerateNotebooklmInfographicViaRpc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        wait: true,
        instructions: 'Focus on performance bottlenecks',
        orientation: 'portrait',
        detail: 'detailed',
        style: 'scientific',
      }),
    );
  });
});
