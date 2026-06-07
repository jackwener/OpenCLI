import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox-done.js';

function makePage(result = { kind: 'ok', rows: { ok: true } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock inbox-done', () => {
  const command = getRegistry().get('slock/inbox-done');

  it('resolves a #name channel and POSTs channelId in the body of /inbox/done', async () => {
    const page = makePage();
    const rows = await command.func(page, { channel: '#general' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('"general"');          // channel-name resolution embedded
    expect(script).toContain('/channels/inbox/done'); // fixed path, channelId in body
    expect(script).toContain('channelId');
    expect(rows[0]).toMatchObject({ channel: '#general', result: 'done' });
  });
});
