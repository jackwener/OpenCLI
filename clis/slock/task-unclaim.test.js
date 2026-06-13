import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './task-unclaim.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-unclaim', () => {
  const command = getRegistry().get('slock/task-unclaim');

  it('rejects short ids before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { taskId: 'abc12345' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('hits PATCH /api/tasks/:id/unclaim on happy path', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'todo', assigneeId: null, taskNumber: 7 }] });
    const rows = await command.func(page, { taskId: ID });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('/api/tasks/');
    expect(snippet).toContain('/unclaim');
    expect(snippet).toContain("method:'PATCH'");
    expect(rows[0]).toMatchObject({ taskId: ID, taskStatus: 'todo', assigneeId: null, taskNumber: 7 });
  });

  it('[F6] 409 surfaces actionable hint (not claimed, or terminal)', async () => {
    const page = makePage({ kind: 'http', status: 409, where: '/tasks/:id/unclaim (conflict — task is not claimed, or already in a terminal state (done/closed))' });
    await expect(command.func(page, { taskId: ID }))
      .rejects.toThrow(/not claimed|terminal|409/);
  });

  it('403 surfaces actionable detail (not assignee / terminal / archived)', async () => {
    const page = makePage({ kind: 'http', status: 403, where: '/tasks/:id/unclaim (forbidden — not the assignee, terminal status, or channel archived)' });
    await expect(command.func(page, { taskId: ID }))
      .rejects.toThrow(/forbidden|403/);
  });

  it('[postcondition] rejects a 2xx unclaim response without task identity', async () => {
    const page = makePage({ kind: 'ok', rows: [{ taskStatus: 'todo' }] });
    await expect(command.func(page, { taskId: ID }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });
});
