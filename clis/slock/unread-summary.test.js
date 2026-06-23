import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './unread-summary.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock unread-summary', () => {
  const command = getRegistry().get('slock/unread-summary');

  it('passes through the enriched rows the in-page join produced', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { serverId: 's1', slug: 'eng', name: 'Engineering', unreadCount: 4 },
    ] });
    const rows = await command.func(page, {});
    expect(rows[0]).toMatchObject({ serverId: 's1', slug: 'eng', unreadCount: 4 });
  });

  it('is user-scoped — the snippet never resolves a server slug', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, {});
    // serverScoped:false ⇒ no slug→X-Server-Id lookup (sid stays null).
    expect(page.evaluate.mock.calls[0][0]).not.toContain('slock_last_server_slug');
  });

  it('[anti-drift] non-array rows throws instead of silently returning empty', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, {})).rejects.toThrow(/expected array/);
  });
});
