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

  // F7 — qatester live-flagged: archived channels are excluded from the
  // channelResolveFragment lookup (which lists active channels only), so
  // `channel-unarchive #name` always errored with "no channel matches".
  // Unarchive opts into a hint that points the user at the UUID escape hatch.
  it('[F7] channel-unarchive rewrites "no channel matches" into an actionable archived-channel hint', async () => {
    const command = getRegistry().get('slock/channel-unarchive');
    const page = makePage({ kind: 'unresolvable', detail: 'no channel matches "old-channel"' });
    await expect(command.func(page, { channel: '#old-channel' }))
      .rejects.toThrow(/Archived channels are excluded.*UUID/);
  });

  // Sister verbs (join / leave / archive) should NOT get the unarchive hint
  // — they fail loud with the bare "no channel matches" because the user can
  // see and #name a non-archived channel.
  it('[F7] non-unarchive sister verbs do NOT inject the archived hint', async () => {
    for (const name of ['channel-join', 'channel-leave', 'channel-archive']) {
      const command = getRegistry().get(`slock/${name}`);
      const page = makePage({ kind: 'unresolvable', detail: 'no channel matches "nope"' });
      await expect(command.func(page, { channel: '#nope' }))
        .rejects.toThrow(/no channel matches/);
      // Verify the hint text is absent from the thrown message.
      await expect(command.func(page, { channel: '#nope' }))
        .rejects.not.toThrow(/Archived channels are excluded/);
    }
  });
});
