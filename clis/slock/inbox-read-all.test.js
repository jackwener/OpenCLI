import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox-read-all.js';

function makePage(result = { kind: 'ok', rows: { ok: true, markedCount: 7 } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock inbox-read-all', () => {
  const command = getRegistry().get('slock/inbox-read-all');

  it('POSTs /channels/inbox/read-all and surfaces markedCount', async () => {
    const page = makePage();
    const rows = await command.func(page, {});
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('/channels/inbox/read-all');
    expect(script).toContain('"POST"');
    expect(rows[0]).toMatchObject({ result: 'read-all', markedCount: 7 });
  });
});
