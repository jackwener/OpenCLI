import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetConversationDetail } = vi.hoisted(() => ({
  mockGetConversationDetail: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    getConversationDetail: mockGetConversationDetail,
  };
});

import { getRegistry } from '../../src/registry.js';
import './detail.js';

describe('doubao detail', () => {
  const detail = getRegistry().get('doubao/detail');

  beforeEach(() => {
    mockGetConversationDetail.mockReset();
  });

  it('returns meeting metadata even when the conversation has no chat messages', async () => {
    mockGetConversationDetail.mockResolvedValue({
      messages: [],
      meeting: {
        title: 'Weekly Sync',
        time: '2026-03-28 10:00',
      },
    });

    const result = await detail!.func!({} as any, { id: '1234567890' });

    expect(result).toEqual([
      { Role: 'Meeting', Text: 'Weekly Sync (2026-03-28 10:00)' },
    ]);
  });

  it('still returns an error row for a truly empty conversation', async () => {
    mockGetConversationDetail.mockResolvedValue({
      messages: [],
      meeting: null,
    });

    const result = await detail!.func!({} as any, { id: '1234567890' });

    expect(result).toEqual([
      { Role: 'System', Text: 'No messages found. Verify the conversation ID.' },
    ]);
  });
});
