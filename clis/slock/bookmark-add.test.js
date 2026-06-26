import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark-add.js';

function makePage(result = { kind: 'ok', rows: [{ id: 'b1' }] }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock bookmark-add', () => {
  const command = getRegistry().get('slock/bookmark-add');

  it('short id is rejected with a hint mentioning "NOT accepted", before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: '8af3cbbb' }))
      .rejects.toThrow(/NOT accepted/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('full UUID POSTs to /channels/saved and reports saved=true when server returns { ok: true }', async () => {
    // F3-a — qatester live dump: server returns { ok: true } with NO id.
    // The dispatched envelope here mirrors what the in-page snippet emits
    // post-shape-parse: row carries `saved: true`, not a bookmarkId.
    const page = makePage({ kind: 'ok', rows: [{ saved: true, messageId: '550e8400-e29b-41d4-a716-446655440000' }] });
    const rows = await command.func(page, { messageId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(rows[0]).toMatchObject({ messageId: '550e8400-e29b-41d4-a716-446655440000', saved: true });
    expect(page.evaluate.mock.calls[0][0]).toContain('/channels/saved');
  });

  // F3-a drift: a future refactor that re-introduces `data.bookmarkId ?? data.id`
  // would silently surface null again. Pin the in-page check on data.ok === true.
  it('[F3-a drift] in-page snippet reads data.ok (not data.id / data.bookmarkId)', async () => {
    const page = makePage();
    await command.func(page, { messageId: '550e8400-e29b-41d4-a716-446655440000' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('data.ok === true');
    expect(snippet).not.toMatch(/data\.bookmarkId/);
  });
});
