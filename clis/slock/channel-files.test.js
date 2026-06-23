import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-files.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock channel-files', () => {
  const command = getRegistry().get('slock/channel-files');

  it('maps files from the {files} envelope and threads --limit into the query', async () => {
    const page = makePage({ kind: 'ok', rows: { files: [
      { id: 'f1', filename: 'a.png', mimeType: 'image/png', sizeBytes: 1234, messageId: 'm1', createdAt: 't' },
    ], nextCursor: null } });
    const rows = await command.func(page, { channel: '#general', limit: 10 });
    expect(page.evaluate.mock.calls[0][0]).toContain('?limit=10');
    expect(rows[0]).toMatchObject({ id: 'f1', filename: 'a.png', mimeType: 'image/png', sizeBytes: 1234 });
  });

  it('rejects non-positive --limit before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: { files: [] } });
    await expect(command.func(page, { channel: '#general', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('[anti-drift] non-array files throws', async () => {
    const page = makePage({ kind: 'ok', rows: { files: { wrong: 'shape' } } });
    await expect(command.func(page, { channel: '#general' })).rejects.toThrow(/expected files array/);
  });
});
