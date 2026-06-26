import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './task-create.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const CHAN = 'c1111111-1111-1111-1111-111111111111';
const TASK = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-create', () => {
  const command = getRegistry().get('slock/task-create');

  it('refuses an empty title before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { channel: CHAN, title: '   ' }))
      .rejects.toThrow(/title required/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('posts body {tasks:[{title}]} (batch-shape, N=1 — same contract as future R4 multi)', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [{ id: TASK, taskNumber: 11, content: 'ship Ph9', taskStatus: 'todo', channelId: CHAN }],
    });
    const rows = await command.func(page, { channel: CHAN, title: 'ship Ph9' });
    expect(page.evaluate).toHaveBeenCalledOnce();
    const snippet = page.evaluate.mock.calls[0][0];
    // Always sends a tasks ARRAY, even for N=1. Drift catch: if someone
    // shortcuts to body: {title}, the server-side validator (Bugen contract:
    // body.tasks: Array) 400s — this assertion catches that pre-network.
    expect(snippet).toContain('tasks: [');
    expect(snippet).toContain('"title":"ship Ph9"');
    expect(snippet).toContain('/api/tasks/channel/');
    expect(snippet).toContain("method:'POST'");
    expect(rows[0]).toMatchObject({ id: TASK, taskNumber: 11, title: 'ship Ph9', taskStatus: 'todo', channelId: CHAN });
  });

  it('embeds description into the task object when --desc is set', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: TASK, taskNumber: 12, taskStatus: 'todo' }] });
    await command.func(page, { channel: CHAN, title: 'with desc', desc: 'longer body here' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('"description":"longer body here"');
  });

  it('OMITS description from body when --desc is absent (server may treat empty vs missing differently)', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: TASK, taskNumber: 13, taskStatus: 'todo' }] });
    await command.func(page, { channel: CHAN, title: 'no-desc' });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).not.toContain('"description"');
  });

  it('409 conflict from thread channel surfaces the actionable hint (joint_unsupported)', async () => {
    const page = makePage({ kind: 'http', status: 409, where: '/tasks/channel/:id (conflict — thread channels do not accept tasks; pick the parent channel)' });
    await expect(command.func(page, { channel: CHAN, title: 'x' }))
      .rejects.toThrow(/thread channels do not accept|409/);
  });

  it('400 surfaces the server\'s validation error verbatim (title shape / batch limit)', async () => {
    const page = makePage({ kind: 'http', status: 400, where: '/tasks/channel/:id (bad request: title too long)' });
    await expect(command.func(page, { channel: CHAN, title: 'too-long' }))
      .rejects.toThrow(/bad request|400/);
  });
});
