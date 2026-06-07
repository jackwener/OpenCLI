import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-members.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock channel-members', () => {
  const command = getRegistry().get('slock/channel-members');

  it('returns members on happy path', async () => {
    const page = makePage({ kind: 'ok', rows: [{ userId: 'u1', name: 'Alice' }] });
    const rows = await command.func(page, { channel: 'c1-uuid-aaaa-bbbb-cccc-dddddddddddd' });
    expect(rows[0]).toMatchObject({ userId: 'u1', name: 'Alice' });
  });

  it('passes channel-name input into the snippet so the browser can resolve it', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { channel: '#general' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"general"');
  });
});
