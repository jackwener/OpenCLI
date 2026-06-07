import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './task-list.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock task-list', () => {
  const command = getRegistry().get('slock/task-list');

  it('returns tasks from /tasks/channel/:id on happy path', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: 't1', title: 'do it', status: 'open' }] });
    const rows = await command.func(page, { channel: 'c1-uuid-aaaa-bbbb-cccc-dddddddddddd' });
    expect(rows[0]).toMatchObject({ id: 't1', title: 'do it', status: 'open' });
  });

  it('uses /tasks/v2/... endpoint when --v2 flag is set', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { channel: 'c1-uuid-aaaa-bbbb-cccc-dddddddddddd', v2: true });
    expect(page.evaluate.mock.calls[0][0]).toContain('/api/tasks/v2/');
  });
});
