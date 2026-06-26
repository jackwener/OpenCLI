import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-mark.js';

function makePage(result = { kind: 'ok', rows: { ok: true } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock channel-mark', () => {
  const command = getRegistry().get('slock/channel-mark');

  it('default marks read-all', async () => {
    const page = makePage({ kind: 'ok', rows: { ok: true, seq: 99 } });
    const rows = await command.func(page, { channel: '#general' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('"/read-all"');
    expect(rows[0]).toMatchObject({ action: 'read-all', result: 'seq=99' });
  });

  it('--seq marks read up to a seq and sends it in the body', async () => {
    const page = makePage({ kind: 'ok', rows: { ok: true } });
    const rows = await command.func(page, { channel: '#general', seq: 42 });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('"/read"');
    expect(script).not.toContain('"/read-all"');
    expect(rows[0]).toMatchObject({ action: 'read-to-42' });
  });

  it('--unread marks unread', async () => {
    const page = makePage({ kind: 'ok', rows: { ok: true, unreadCount: 3 } });
    const rows = await command.func(page, { channel: '#general', unread: true });
    expect(page.evaluate.mock.calls[0][0]).toContain('"/unread"');
    expect(rows[0]).toMatchObject({ action: 'unread', result: 'unreadCount=3' });
  });

  it('--unread and --seq together is rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { channel: '#g', unread: true, seq: 5 }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('non-positive --seq is rejected', async () => {
    const page = makePage();
    await expect(command.func(page, { channel: '#g', seq: 0 }))
      .rejects.toBeInstanceOf(ArgumentError);
  });
});
