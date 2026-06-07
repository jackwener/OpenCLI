import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './message-search.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock message-search', () => {
  const command = getRegistry().get('slock/message-search');

  it('happy: returns mapped rows for a query', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'm1', content: 'hello', channelId: 'c1', sender: { name: 'A' }, createdAt: 't' },
    ]});
    const rows = await command.func(page, { query: 'hello' });
    expect(rows[0]).toMatchObject({ id: 'm1', content: 'hello', channelId: 'c1' });
  });

  it('--channel filter: snippet contains channelId param', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { query: 'x', channel: '#general' });
    expect(page.evaluate.mock.calls[0][0]).toContain('channelId=');
  });
});
