import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './task-claim.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-claim', () => {
  const command = getRegistry().get('slock/task-claim');

  it('rejects short ids before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { taskId: 'abc12345' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('hits PATCH /api/tasks/:id/claim on happy path and surfaces taskStatus/assignee', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'in_progress', assigneeId: 'u1', taskNumber: 7 }] });
    const rows = await command.func(page, { taskId: ID });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('/api/tasks/');
    expect(snippet).toContain('/claim');
    expect(snippet).toContain("method:'PATCH'");
    expect(rows[0]).toMatchObject({ taskId: ID, taskStatus: 'in_progress', assigneeId: 'u1', taskNumber: 7 });
  });

  it('409 conflict surfaces actionable message (already claimed)', async () => {
    const page = makePage({ kind: 'http', status: 409, where: '/tasks/:id/claim (conflict — already claimed by someone else; use task-unclaim first)' });
    await expect(command.func(page, { taskId: ID }))
      .rejects.toThrow(/already claimed|409/);
  });

  it('404 not-found stays distinct from 403 forbidden (no conflate)', async () => {
    const page404 = makePage({ kind: 'http', status: 404, where: '/tasks/:id/claim (task not found)' });
    await expect(command.func(page404, { taskId: ID })).rejects.toThrow(/not found|404/);

    const page403 = makePage({ kind: 'http', status: 403, where: '/tasks/:id/claim (forbidden — not your task, terminal status, or channel archived)' });
    await expect(command.func(page403, { taskId: ID })).rejects.toThrow(/forbidden|403/);
  });

  it('passes --server override into authHeadersFragment', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID }] });
    await command.func(page, { taskId: ID, server: 'jackyland' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"jackyland"');
  });
});
