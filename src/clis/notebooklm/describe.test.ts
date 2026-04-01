import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDescribeNotebooklmNotebookViaRpc,
  mockEnsureNotebooklmHome,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockDescribeNotebooklmNotebookViaRpc: vi.fn(),
  mockEnsureNotebooklmHome: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    describeNotebooklmNotebookViaRpc: mockDescribeNotebooklmNotebookViaRpc,
    ensureNotebooklmHome: mockEnsureNotebooklmHome,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './describe.js';

describe('notebooklm describe', () => {
  const command = getRegistry().get('notebooklm/describe');

  beforeEach(() => {
    mockDescribeNotebooklmNotebookViaRpc.mockReset();
    mockEnsureNotebooklmHome.mockReset();
    mockRequireNotebooklmSession.mockReset();
    mockEnsureNotebooklmHome.mockResolvedValue(undefined);
    mockRequireNotebooklmSession.mockResolvedValue(undefined);
  });

  it('returns the notebook description and suggested topics via rpc', async () => {
    mockDescribeNotebooklmNotebookViaRpc.mockResolvedValue({
      notebook_id: 'nb-demo',
      summary: '这是 notebook 的摘要。',
      suggested_topics: [
        { question: '问题一？', prompt: 'Prompt one' },
      ],
      suggested_topic_count: 1,
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });

    const result = await command!.func!({} as any, { notebook_id: 'nb-demo' });

    expect(mockDescribeNotebooklmNotebookViaRpc).toHaveBeenCalledWith(expect.anything(), 'nb-demo');
    expect(result).toEqual([
      expect.objectContaining({
        notebook_id: 'nb-demo',
        summary: '这是 notebook 的摘要。',
        suggested_topic_count: 1,
        source: 'rpc',
      }),
    ]);
  });
});
