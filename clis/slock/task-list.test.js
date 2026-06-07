import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './task-list.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock task-list', () => {
  const command = getRegistry().get('slock/task-list');

  it('returns unwrapped {tasks:[]} on happy path and maps task fields', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [
        { id: 'm1', taskNumber: 7, content: 'do it', taskStatus: 'todo', assigneeId: null },
        { id: 'm2', taskNumber: 8, content: 'next', taskStatus: 'in_progress', assigneeId: 'u1' },
      ],
    });
    const rows = await command.func(page, { channel: 'c1-uuid-aaaa-bbbb-cccc-dddddddddddd' });
    expect(rows[0]).toMatchObject({ id: 'm1', taskNumber: 7, title: 'do it', taskStatus: 'todo', assigneeId: null });
    expect(rows[1]).toMatchObject({ id: 'm2', taskNumber: 8, title: 'next', taskStatus: 'in_progress', assigneeId: 'u1' });
  });

  it('passes ?status=<value> through when --status is set (server-side filter)', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { channel: '11111111-1111-1111-1111-111111111111', status: 'in_review' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('?status=');
    expect(snippet).toContain('"in_review"');
  });

  it('rejects an invalid --status before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { channel: '11111111-1111-1111-1111-111111111111', status: 'broken' }))
      .rejects.toThrow(/status "broken"/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('[drift] non-{tasks:[]} response surfaces as a clean http error (not silently empty)', async () => {
    const page = makePage({ kind: 'http', status: 200, where: '/tasks/channel/:id (expected {tasks:[]}, got drift)' });
    await expect(command.func(page, { channel: '11111111-1111-1111-1111-111111111111' }))
      .rejects.toThrow(/drift|HTTP 200/);
  });

  it('[anti-drift] non-array rows from dispatch throws instead of silently returning empty', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, { channel: '11111111-1111-1111-1111-111111111111' })).rejects.toThrow(/expected array/);
  });

  it('[dead-code removal] no /tasks/v2/ endpoint or --v2 flag survives', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { channel: '11111111-1111-1111-1111-111111111111' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).not.toContain('/tasks/v2');
    // The arg surface must also not advertise --v2 anymore.
    expect(command.args.find((a) => a.name === 'v2')).toBeUndefined();
  });
});
