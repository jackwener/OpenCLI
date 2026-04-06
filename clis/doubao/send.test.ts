import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

const mocks = vi.hoisted(() => ({
  navigateToConversation: vi.fn(),
  sendDoubaoMessage: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    navigateToConversation: mocks.navigateToConversation,
    sendDoubaoMessage: mocks.sendDoubaoMessage,
  };
});

import { sendCommand } from './send.js';

describe('doubao send --thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendDoubaoMessage.mockResolvedValue('button');
  });

  it('navigates to the requested conversation id before sending', async () => {
    const page = {} as IPage;

    await sendCommand.func!(page, {
      text: '补充一句',
      thread: '1234567890123',
    });

    expect(mocks.navigateToConversation).toHaveBeenCalledWith(page, '1234567890123');
    expect(mocks.sendDoubaoMessage).toHaveBeenCalledWith(page, '补充一句');
  });
});
