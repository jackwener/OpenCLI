import { describe, it, expect, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './attachment-url.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock attachment-url', () => {
  const command = getRegistry().get('slock/attachment-url');

  it('rejects a non-UUID attachmentId before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: {} });
    await expect(command.func(page, { attachmentId: 'short8x' }))
      .rejects.toThrow(/not a UUID/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('hits GET /api/attachments/:id/url and surfaces { url, expiresAt }', async () => {
    const page = makePage({
      kind: 'ok',
      rows: { url: 'https://cdn.slock.ai/a/550e8400.bin?sig=abc', expiresAt: '2026-06-07T13:00:00Z' },
    });
    const rows = await command.func(page, { attachmentId: ID });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain(`/api/attachments/${encodeURIComponent(ID)}/url`);
    expect(rows[0]).toMatchObject({
      attachmentId: ID,
      url: 'https://cdn.slock.ai/a/550e8400.bin?sig=abc',
      expiresAt: '2026-06-07T13:00:00Z',
    });
  });

  it('fails typed when the signed url is missing', async () => {
    const page = makePage({ kind: 'ok', rows: { expiresAt: 'soon' } });
    await expect(command.func(page, { attachmentId: ID })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
