import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';

const mocks = vi.hoisted(() => ({
  getDoubaoVisibleTurns: vi.fn(),
  getDoubaoTranscriptLines: vi.fn(),
  navigateToConversation: vi.fn(),
  sendDoubaoMessage: vi.fn(),
  waitForDoubaoResponse: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getDoubaoVisibleTurns: mocks.getDoubaoVisibleTurns,
    getDoubaoTranscriptLines: mocks.getDoubaoTranscriptLines,
    navigateToConversation: mocks.navigateToConversation,
    sendDoubaoMessage: mocks.sendDoubaoMessage,
    waitForDoubaoResponse: mocks.waitForDoubaoResponse,
  };
});

import { askCommand } from './ask.js';

function createPageMock(): IPage {
  return {
    wait: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPage;
}

describe('doubao ask --thread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDoubaoVisibleTurns.mockResolvedValue([]);
    mocks.getDoubaoTranscriptLines.mockResolvedValue([]);
    mocks.sendDoubaoMessage.mockResolvedValue('button');
    mocks.waitForDoubaoResponse.mockResolvedValue('继续');
  });

  it('navigates to the requested conversation id before sending', async () => {
    const page = createPageMock();

    await askCommand.func!(page, {
      text: '继续',
      thread: 'https://www.doubao.com/chat/1234567890123',
      timeout: '60',
    });

    expect(mocks.navigateToConversation).toHaveBeenCalledWith(page, '1234567890123');
    expect(mocks.sendDoubaoMessage).toHaveBeenCalledWith(page, '继续');
  });
});
