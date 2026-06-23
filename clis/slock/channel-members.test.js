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

  // F2-a — qatester live dump: the real response is split { agents: [...],
  // humans: [...] }, not a flat array or under `.members`. The old parser
  // returned [] silently; the fix combines both and tags each row with `kind`.
  it('[F2-a real shape] combines agents + humans and tags each row with kind', async () => {
    const page = makePage({ kind: 'ok', rows: {
      agents: [
        { id: 'a1', name: 'qatester', status: 'online', activity: 'idle' },
      ],
      humans: [
        { id: 'h1', name: 'jacky_zhong', role: 'owner' },
        { id: 'h2', name: 'someone', role: 'member' },
      ],
    } });
    const rows = await command.func(page, { channel: 'c1-uuid-aaaa-bbbb-cccc-dddddddddddd' });
    expect(rows.length).toBe(3);
    // Humans come first, then agents (stable ordering for table rendering).
    expect(rows[0]).toMatchObject({ userId: 'h1', name: 'jacky_zhong', kind: 'human', role: 'owner' });
    expect(rows[1]).toMatchObject({ userId: 'h2', name: 'someone', kind: 'human', role: 'member' });
    expect(rows[2]).toMatchObject({ userId: 'a1', name: 'qatester', kind: 'agent' });
  });
});
