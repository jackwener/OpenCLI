import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './task-get.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const CHAN = '11111111-1111-1111-1111-111111111111';

describe('slock task-get', () => {
  const command = getRegistry().get('slock/task-get');

  it('rejects a non-integer number before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { channel: CHAN, number: 'seven' }))
      .rejects.toThrow(/positive integer/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects zero before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { channel: CHAN, number: '0' }))
      .rejects.toThrow(/positive integer/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('hits GET /api/tasks/channel/:id/number/:n — keeps the /number/ segment (Bugen contract)', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: 'm1', taskNumber: 7, content: 'task seven', taskStatus: 'todo' }] });
    const rows = await command.func(page, { channel: CHAN, number: '7' });
    const snippet = page.evaluate.mock.calls[0][0];
    // Drift catch: dispatched URL had no /number/; if a future refactor
    // drops /number/, server 404s. Pin it.
    expect(snippet).toContain('/api/tasks/channel/');
    expect(snippet).toContain("'/number/'");
    expect(snippet).toContain('"7"');
    expect(rows[0]).toMatchObject({ id: 'm1', taskNumber: 7, title: 'task seven', taskStatus: 'todo' });
  });

  it('404 surfaces a clear actionable message naming the missing number', async () => {
    const page = makePage({ kind: 'http', status: 404, where: '/tasks/channel/:id/number/:n (task #999 not found in channel)' });
    await expect(command.func(page, { channel: CHAN, number: '999' }))
      .rejects.toThrow(/not found|404/);
  });
});
