import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './task-list-server.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

describe('slock task-list-server', () => {
  const command = getRegistry().get('slock/task-list-server');

  it('hits GET /api/tasks/server (no channel path segment) on happy path', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [
        { id: 'm1', taskNumber: 1, content: 'a', taskStatus: 'todo', channelId: 'c1' },
        { id: 'm2', taskNumber: 2, content: 'b', taskStatus: 'in_progress', channelId: 'c2' },
      ],
    });
    const rows = await command.func(page, {});
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('/api/tasks/server');
    expect(snippet).not.toContain('/api/tasks/channel/');
    expect(rows.length).toBe(2);
    expect(rows[0].title).toBe('a');
    expect(rows[1].channelId).toBe('c2');
  });

  it('passes ?status= through when --status is set', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { status: '  todo  ' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('?status=');
    expect(snippet).toContain('"todo"');
    expect(snippet).not.toContain('"  todo  "');
  });

  it('rejects an invalid --status before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { status: 'broken' }))
      .rejects.toThrow(/status "broken"/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('[drift] non-{tasks:[]} response surfaces as http error', async () => {
    const page = makePage({ kind: 'http', status: 200, where: '/tasks/server (expected {tasks:[]}, got drift)' });
    await expect(command.func(page, {})).rejects.toThrow(/drift|HTTP 200/);
  });
});
