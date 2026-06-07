import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-join.js';
import './channel-leave.js';
import './channel-archive.js';
import './channel-unarchive.js';

function makePage(result = { kind: 'ok', rows: { ok: true } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

const CASES = [
  ['channel-join', 'join', 'joined'],
  ['channel-leave', 'leave', 'left'],
  ['channel-archive', 'archive', 'archived'],
  ['channel-unarchive', 'unarchive', 'unarchived'],
];

describe('slock channel-action factory', () => {
  for (const [name, verb, label] of CASES) {
    const command = getRegistry().get(`slock/${name}`);

    it(`${name}: resolves #name and POSTs /channels/:id/${verb}`, async () => {
      const page = makePage();
      const rows = await command.func(page, { channel: '#general' });
      const script = page.evaluate.mock.calls[0][0];
      expect(script).toContain('"general"');   // channel-name resolution
      expect(script).toContain(`"/${verb}"`);   // verb path suffix
      expect(rows[0]).toMatchObject({ channel: '#general', result: label });
    });
  }

  it('archive surfaces archivedAt from the updated channel', async () => {
    const command = getRegistry().get('slock/channel-archive');
    const page = makePage({ kind: 'ok', rows: { id: 'c1', archivedAt: '2026-06-07T00:00:00Z' } });
    const rows = await command.func(page, { channel: '#general' });
    expect(rows[0]).toMatchObject({ id: 'c1', archivedAt: '2026-06-07T00:00:00Z', result: 'archived' });
  });
});
