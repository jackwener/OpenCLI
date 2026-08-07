import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Command, Result } from './protocol';
import { executeWithJournal, __test__ } from './journal';

function makeCmd(id: string): Command {
  return { id, action: 'exec', code: '1 + 1', session: 's', surface: 'browser' };
}

function makeSessionStorageMock() {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => { store = { ...store, ...items }; }),
    _dump: () => store,
    _load: (items: Record<string, unknown>) => { store = items; },
  };
}

describe('command journal', () => {
  let sessionStorage: ReturnType<typeof makeSessionStorageMock>;

  beforeEach(() => {
    __test__.reset();
    sessionStorage = makeSessionStorageMock();
    vi.stubGlobal('chrome', { storage: { session: sessionStorage } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('executes a fresh id once and replays the recorded result for duplicates', async () => {
    const execute = vi.fn(async (cmd: Command): Promise<Result> => ({ id: cmd.id, ok: true, data: 42 }));

    const first = await executeWithJournal(makeCmd('cmd-1'), execute);
    const replay = await executeWithJournal(makeCmd('cmd-1'), execute);

    expect(first).toEqual({ id: 'cmd-1', ok: true, data: 42 });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('attaches concurrent duplicates to the in-flight execution', async () => {
    let release: (r: Result) => void;
    const gate = new Promise<Result>((resolve) => { release = resolve; });
    const execute = vi.fn(() => gate);

    const a = executeWithJournal(makeCmd('cmd-2'), execute);
    const b = executeWithJournal(makeCmd('cmd-2'), execute);
    release!({ id: 'cmd-2', ok: true, data: 'once' });

    expect(await a).toEqual({ id: 'cmd-2', ok: true, data: 'once' });
    expect(await b).toEqual({ id: 'cmd-2', ok: true, data: 'once' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reports command_lost when a started entry survives a worker restart', async () => {
    // Simulate: previous worker persisted 'started', then died mid-execution.
    sessionStorage._load({
      opencli_command_journal_v1: { 'cmd-3': { status: 'started', ts: Date.now() } },
    });

    const execute = vi.fn();
    const result = await executeWithJournal(makeCmd('cmd-3'), execute);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('command_lost');
    expect(execute).not.toHaveBeenCalled();
  });

  it('replays a completed result persisted by a previous worker', async () => {
    const recorded: Result = { id: 'cmd-4', ok: true, data: 'from-previous-worker' };
    sessionStorage._load({
      opencli_command_journal_v1: { 'cmd-4': { status: 'done', ts: Date.now(), result: recorded } },
    });

    const execute = vi.fn();
    const result = await executeWithJournal(makeCmd('cmd-4'), execute);

    expect(result).toEqual(recorded);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports result_evicted for oversized results instead of re-executing', async () => {
    const huge = 'x'.repeat(65 * 1024);
    const execute = vi.fn(async (cmd: Command): Promise<Result> => ({ id: cmd.id, ok: true, data: huge }));

    const first = await executeWithJournal(makeCmd('cmd-5'), execute);
    const replay = await executeWithJournal(makeCmd('cmd-5'), execute);

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(false);
    expect(replay.errorCode).toBe('result_evicted');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records a thrown execution as a done error result and replays it', async () => {
    const execute = vi.fn(async () => { throw new Error('boom'); });

    const first = await executeWithJournal(makeCmd('cmd-6'), execute);
    const replay = await executeWithJournal(makeCmd('cmd-6'), execute);

    expect(first).toMatchObject({ id: 'cmd-6', ok: false, error: 'boom' });
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('degrades to in-memory when chrome.storage.session is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    __test__.reset();
    const execute = vi.fn(async (cmd: Command): Promise<Result> => ({ id: cmd.id, ok: true, data: 1 }));

    const first = await executeWithJournal(makeCmd('cmd-7'), execute);
    const replay = await executeWithJournal(makeCmd('cmd-7'), execute);

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
