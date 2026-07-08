import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './thread-list.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock thread-list', () => {
  const command = getRegistry().get('slock/thread-list');

  it('maps followed-thread rows from the {threads} envelope', async () => {
    const page = makePage({ kind: 'ok', rows: { threads: [
      { threadChannelId: 'th1', parentMessageId: 'm1', parentChannelName: 'eng', unreadCount: 2, replyCount: 5, lastReplyAt: 't' },
    ] } });
    const rows = await command.func(page, {});
    expect(rows[0]).toMatchObject({ threadChannelId: 'th1', parentMessageId: 'm1', parentChannelName: 'eng', unreadCount: 2, replyCount: 5 });
  });

  it('[anti-drift] non-array threads throws', async () => {
    const page = makePage({ kind: 'ok', rows: { threads: { wrong: 'shape' } } });
    await expect(command.func(page, {})).rejects.toThrow(/expected threads array/);
  });
});
