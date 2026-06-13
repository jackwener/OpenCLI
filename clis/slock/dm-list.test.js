import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './dm-list.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock dm-list', () => {
  const command = getRegistry().get('slock/dm-list');

  it('maps peer fields, preferring displayName', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'c1', peerName: 'alice', peerDisplayName: 'Alice A', peerId: 'u1', createdAt: 't' },
      { id: 'c2', peerName: 'bot', peerId: 'a1' },
    ] });
    const rows = await command.func(page, {});
    expect(rows[0]).toMatchObject({ channelId: 'c1', peerName: 'Alice A', peerId: 'u1' });
    expect(rows[1]).toMatchObject({ channelId: 'c2', peerName: 'bot', peerId: 'a1' });
  });

  it('[anti-drift] non-array rows throws instead of silently returning empty', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, {})).rejects.toThrow(/expected array/);
  });
});
