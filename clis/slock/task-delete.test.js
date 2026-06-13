import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './task-delete.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-delete', () => {
  const command = getRegistry().get('slock/task-delete');

  it('rejects short ids before any other check', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { taskId: 'abc12345', confirm: true }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('[red-line] without --confirm: zero network and returns a planned-noop row', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    const rows = await command.func(page, { taskId: ID });
    // The whole point of the gate: page MUST NOT be touched.
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ taskId: ID, deleted: false });
  });

  it('with --confirm: hits DELETE /api/tasks/:id and surfaces deleted:true', async () => {
    const page = makePage({ kind: 'ok', rows: [{ taskId: ID, deleted: true }] });
    const rows = await command.func(page, { taskId: ID, confirm: true });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain("method:'DELETE'");
    expect(snippet).toContain('/api/tasks/');
    expect(rows[0]).toMatchObject({ taskId: ID, deleted: true });
  });

  it('403 surfaces actionable hint (not owner / channel archived)', async () => {
    const page = makePage({ kind: 'http', status: 403, where: '/tasks/:taskId (forbidden — not the owner/admin or channel archived)' });
    await expect(command.func(page, { taskId: ID, confirm: true }))
      .rejects.toThrow(/forbidden|403/);
  });

  it('404 stays distinct from 403 (no conflate)', async () => {
    const page = makePage({ kind: 'http', status: 404, where: '/tasks/:taskId (task not found)' });
    await expect(command.func(page, { taskId: ID, confirm: true }))
      .rejects.toThrow(/not found|404/);
  });
});
