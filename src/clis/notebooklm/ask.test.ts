import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAskNotebooklmQuestionViaQuery,
  mockGetNotebooklmPageState,
  mockRequireNotebooklmSession,
} = vi.hoisted(() => ({
  mockAskNotebooklmQuestionViaQuery: vi.fn(),
  mockGetNotebooklmPageState: vi.fn(),
  mockRequireNotebooklmSession: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    askNotebooklmQuestionViaQuery: mockAskNotebooklmQuestionViaQuery,
    getNotebooklmPageState: mockGetNotebooklmPageState,
    requireNotebooklmSession: mockRequireNotebooklmSession,
  };
});

import { getRegistry } from '../../registry.js';
import './ask.js';

describe('notebooklm ask', () => {
  const command = getRegistry().get('notebooklm/ask');

  beforeEach(() => {
    mockAskNotebooklmQuestionViaQuery.mockReset();
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

  it('submits the prompt to the current notebook and returns the answer body', async () => {
    mockAskNotebooklmQuestionViaQuery.mockResolvedValue({
      notebook_id: 'nb-demo',
      prompt: '用一句话总结这个 notebook',
      answer: '这是一个关于 Browser Automation 的 notebook。',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'query-endpoint',
    });

    const result = await command!.func!({} as any, { prompt: '用一句话总结这个 notebook' });

    expect(mockAskNotebooklmQuestionViaQuery).toHaveBeenCalledWith(
      expect.anything(),
      '用一句话总结这个 notebook',
    );
    expect(result).toEqual([
      {
        notebook_id: 'nb-demo',
        prompt: '用一句话总结这个 notebook',
        answer: '这是一个关于 Browser Automation 的 notebook。',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'query-endpoint',
      },
    ]);
  });
});
