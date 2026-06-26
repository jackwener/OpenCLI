import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock inbox', () => {
  const command = getRegistry().get('slock/inbox');

  it('rejects an unknown --filter before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: { items: [] } });
    await expect(command.func(page, { filter: 'starred' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('threads filter/limit/offset through the query string', async () => {
    const page = makePage({ kind: 'ok', rows: { items: [] } });
    await command.func(page, { filter: 'unread', limit: 5, offset: 10 });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('filter=unread');
    expect(script).toContain('limit=5');
    expect(script).toContain('offset=10');
  });

  it('rejects invalid pagination before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: { items: [] } });
    await expect(command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { offset: -1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('flattens channel and thread items into a uniform row shape', async () => {
    const page = makePage({ kind: 'ok', rows: { items: [
      { kind: 'channel', channelId: 'c1', channelName: 'general', unreadCount: 3, hasMention: true, lastMessageAt: 't1', lastMessagePreview: 'hi' },
      { kind: 'thread', threadChannelId: 'th1', parentChannelName: 'eng', unreadCount: 1, hasMention: false, lastActivityAt: 't2', latestActivityPreview: 'reply' },
    ] } });
    const rows = await command.func(page, {});
    expect(rows[0]).toMatchObject({ kind: 'channel', id: 'c1', name: 'general', unreadCount: 3, hasMention: true });
    expect(rows[1]).toMatchObject({ kind: 'thread', id: 'th1', name: 'eng', unreadCount: 1, preview: 'reply' });
  });
});
