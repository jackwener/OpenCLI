import { describe, expect, it, vi } from 'vitest';

import { askCommand } from './ask.js';

describe('codex ask', () => {
  it('detects a new assistant identity even when virtualized counts are unchanged', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ assistantKey: 'old-key', assistantCount: 1, turnCount: 1 })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('OPENCLI_OK');
    const page = {
      evaluate,
      wait: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
    };

    const result = await askCommand.func(page, { text: 'reply OPENCLI_OK', timeout: 3 });

    expect(result).toEqual([
      { Role: 'User', Project: '', Conversation: '', Text: 'reply OPENCLI_OK' },
      { Role: 'Assistant', Project: '', Conversation: '', Text: 'OPENCLI_OK' },
    ]);
    expect(evaluate.mock.calls[0][0]).toContain('data-content-search-unit-key');
    expect(evaluate.mock.calls[2][0]).toContain('assistantKey');
  });
});
