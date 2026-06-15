import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
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

  // F5 — qatester live dump: server wraps the row as { task: {...} } and
  // names the assignee `claimedById`, NOT `assigneeId`. The in-page snippet
  // owns the unwrap (it runs in the browser, not in this test process), so
  // we assert two things separately:
  //   (i) the snippet emits the unwrap logic — drift catch via string match
  //   (ii) the mapper picks claimedById when present (real field name)
  it('[F5 drift] in-page snippet unwraps data.task before returning the envelope', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'in_progress', claimedById: 'u1', taskNumber: 7 }] });
    await command.func(page, { taskId: ID });
    const snippet = page.evaluate.mock.calls[0][0];
    // The exact unwrap line ensures a future refactor that strips it (or
    // wraps the wrong direction) is caught pre-network.
    expect(snippet).toContain('data && data.task');
  });

  it('[F5 real-shape mapping] claimedById from server maps to assigneeId in output', async () => {
    // Post-unwrap shape (what dispatchEvaluateResult sees): the in-page snippet
    // already pulled `data.task` out, so the row here matches what claim
    // returns from the server with `claimedById` as the assignee key.
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'in_progress', claimedById: 'user-c47a3491', taskNumber: 7, channelId: 'c1' }] });
    const rows = await command.func(page, { taskId: ID });
    expect(rows[0]).toMatchObject({ taskId: ID, taskStatus: 'in_progress', assigneeId: 'user-c47a3491', taskNumber: 7 });
  });

  it('[postcondition] rejects a 2xx claim response with the wrong task identity', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: '550e8400-e29b-41d4-a716-446655440001', taskStatus: 'in_progress' }] });
    await expect(command.func(page, { taskId: ID }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('passes --server override into authHeadersFragment', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'in_progress' }] });
    await command.func(page, { taskId: ID, server: 'jackyland' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"jackyland"');
  });
});
