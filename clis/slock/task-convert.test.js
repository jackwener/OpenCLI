import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './task-convert.js';

function makePage(envelope) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(envelope) };
}

const FULL = '550e8400-e29b-41d4-a716-446655440000';

describe('slock task-convert', () => {
  const command = getRegistry().get('slock/task-convert');

  it('refuses an input that is neither UUID nor "#channel:shortId"', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { messageId: 'not-a-real-thing' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('full UUID input hits POST /api/tasks/convert-message with body {messageId} — no /messages/context lookup', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [{ id: FULL, taskNumber: 21, content: 'converted', taskStatus: 'todo', channelId: 'c1' }],
    });
    const rows = await command.func(page, { messageId: FULL });
    const snippet = page.evaluate.mock.calls[0][0];
    // Endpoint: convert-message under tasks router (NOT a messages PATCH).
    expect(snippet).toContain('/api/tasks/convert-message');
    expect(snippet).toContain("method:'POST'");
    expect(snippet).toMatch(/JSON\.stringify\(\{\s*messageId:\s*fullMsgId\s*\}\)/);
    // UUID path: no /messages/context fetch should appear.
    expect(snippet).not.toContain('/messages/context');
    expect(rows[0]).toMatchObject({ id: FULL, taskNumber: 21, title: 'converted', taskStatus: 'todo', channelId: 'c1' });
  });

  it('"#channel:shortId" input embeds /messages/context lookup AND reads targetMessageId (Phase 7.1 invariant)', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [{ id: FULL, taskNumber: 22, content: 'from short', taskStatus: 'todo' }],
    });
    await command.func(page, { messageId: '#general:8af3cbbb' });
    const snippet = page.evaluate.mock.calls[0][0];

    // The short id triggers /messages/context.
    expect(snippet).toContain('/api/messages/context/');
    // It reads cxd.targetMessageId — NOT m.message.id. Regression catch.
    // Source comments mention the warning string, so strip comments before
    // the negative check; we want to catch CODE that does the wrong read.
    const code = snippet.replace(/\/\/.*$/gm, '');
    expect(code).toContain('cxd.targetMessageId');
    expect(code).not.toMatch(/\bm\.message\.id\b/);
    // And the short id literal appears in the snippet.
    expect(snippet).toContain('"8af3cbbb"');
    expect(snippet).toContain('"general"');
    // Finally still POSTs to convert-message.
    expect(snippet).toContain('/api/tasks/convert-message');
  });

  it('[F5 drift] in-page snippet unwraps data.task before returning the envelope', async () => {
    const page = makePage({ kind: 'ok', rows: [{ id: FULL, taskNumber: 33, content: 'x', taskStatus: 'todo' }] });
    await command.func(page, { messageId: FULL });
    const snippet = page.evaluate.mock.calls[0][0];
    expect(snippet).toContain('data && data.task');
  });

  it('409 already-a-task surfaces actionable hint', async () => {
    const page = makePage({ kind: 'http', status: 409, where: '/tasks/convert-message (conflict — message is already a task, or in a thread channel which does not accept tasks)' });
    await expect(command.func(page, { messageId: FULL }))
      .rejects.toThrow(/already a task|thread channel|409/);
  });

  it('unresolvable short id surfaces ArgumentError (zero POST to convert-message)', async () => {
    const page = makePage({ kind: 'unresolvable', detail: 'short id "zzzzzzzz" not found in #general' });
    await expect(command.func(page, { messageId: '#general:zzzzzzzz' }))
      .rejects.toBeInstanceOf(ArgumentError);
    // The single evaluate is allowed (read-side resolution); snippet returns
    // 'unresolvable' BEFORE the convert POST.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});
