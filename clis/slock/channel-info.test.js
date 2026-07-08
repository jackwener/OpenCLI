import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-info.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock channel-info', () => {
  const command = getRegistry().get('slock/channel-info');

  it('maps the channel object, falling back topic→description', async () => {
    const page = makePage({ kind: 'ok', rows: {
      id: 'c1', name: 'general', type: 'channel', description: 'team chat', joined: true, archivedAt: null,
    } });
    const rows = await command.func(page, { channel: '#general' });
    expect(rows[0]).toMatchObject({ id: 'c1', name: 'general', type: 'channel', topic: 'team chat', joined: true });
  });

  it('passes channel-name input into the snippet for in-page resolution', async () => {
    const page = makePage({ kind: 'ok', rows: { id: 'c1' } });
    await command.func(page, { channel: '#general' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"general"');
  });
});
