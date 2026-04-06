import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

const mocks = vi.hoisted(() => ({
  getDoubaoVisibleTurns: vi.fn(),
  navigateToConversation: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getDoubaoVisibleTurns: mocks.getDoubaoVisibleTurns,
    navigateToConversation: mocks.navigateToConversation,
  };
});

import { readCommand } from './read.js';

describe('doubao read --thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDoubaoVisibleTurns.mockResolvedValue([
      { Role: 'Assistant', Text: '这是指定会话' },
    ]);
  });

  it('navigates to the requested conversation id before reading', async () => {
    const page = {} as IPage;

    const result = await readCommand.func!(page, {
      thread: 'https://www.doubao.com/chat/1234567890123',
    });

    expect(mocks.navigateToConversation).toHaveBeenCalledWith(page, '1234567890123');
    expect(result).toEqual([
      { Role: 'Assistant', Text: '这是指定会话' },
    ]);
  });
});
