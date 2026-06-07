import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './task-status.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-status', () => {
  const command = getRegistry().get('slock/task-status');

  it('rejects short taskId before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { taskId: 'abc12345', status: 'todo' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects an unknown status pre-network (saves the 400 round-trip)', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { taskId: ID, status: 'wip' }))
      .rejects.toThrow(/not in/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('hits PATCH /api/tasks/:taskId/status with body {status} — Bugen contract (NOT {taskStatus}, NOT /tasks/:id without suffix)', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: 'in_progress', taskNumber: 7 }] });
    await command.func(page, { taskId: ID, status: 'in_progress' });
    const snippet = page.evaluate.mock.calls[0][0];

    // Path MUST end in /status — easy drift if a future refactor strips it.
    expect(snippet).toContain('/api/tasks/');
    expect(snippet).toContain("+ '/status'");

    // Body field MUST be `status`, NOT `taskStatus`. The list/get/create
    // responses use taskStatus; the PATCH body uses status. Easy to confuse;
    // explicitly assert both presence-of and absence-of. The snippet is JS
    // source (object literal), so the key is bareword `status:`, not the
    // JSON-quoted `"status":`.
    expect(snippet).toMatch(/JSON\.stringify\(\{\s*status:\s*"in_progress"\s*\}\)/);
    expect(snippet).not.toMatch(/JSON\.stringify\(\{[^}]*taskStatus\s*:/);
    expect(snippet).toContain("method:'PATCH'");
  });

  it('all 5 enum values are accepted pre-network', async () => {
    for (const s of ['todo', 'in_progress', 'in_review', 'done', 'closed']) {
      const page = makePage({ kind: 'ok', rows: [{ id: ID, taskStatus: s }] });
      await command.func(page, { taskId: ID, status: s });
    }
  });

  it('403 terminal-status surfaces actionable hint (done/closed cannot be transitioned)', async () => {
    const page = makePage({ kind: 'http', status: 403, where: '/tasks/:taskId/status (forbidden — terminal status (done/closed), not the assignee, or channel archived)' });
    await expect(command.func(page, { taskId: ID, status: 'in_progress' }))
      .rejects.toThrow(/terminal status|403/);
  });
});
