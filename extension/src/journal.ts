/**
 * Command journal — the executor-side half of the transport's retry contract.
 *
 * The CLI retries a failed transport attempt with the SAME command id; this
 * journal makes that retry safe by making execution idempotent per id:
 *
 * - a command currently executing attaches to the in-flight promise;
 * - a completed command replays its recorded Result instead of re-executing;
 * - a command that started but never finished (service worker died mid-way)
 *   reports `command_lost` instead of silently re-executing a write.
 *
 * Persisted in chrome.storage.session: survives service-worker restarts,
 * cleared when the browser exits — exactly the lifetime of "results a retry
 * might still ask for". When storage is unavailable (tests, very old Chrome)
 * the journal degrades to in-memory only.
 */

import type { Command, Result } from './protocol';

const JOURNAL_KEY = 'opencli_command_journal_v1';
const JOURNAL_MAX_ENTRIES = 64;
/** Results larger than this are not recorded; a replayed id re-fails honestly. */
const JOURNAL_RESULT_MAX_BYTES = 64 * 1024;

type JournalEntry =
  | { status: 'started'; ts: number }
  | { status: 'done'; ts: number; result?: Result };

type JournalMap = Record<string, JournalEntry>;

let cache: JournalMap | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const inFlight = new Map<string, Promise<Result>>();

async function load(): Promise<JournalMap> {
  if (cache) return cache;
  try {
    const stored = await chrome.storage.session.get(JOURNAL_KEY);
    cache = (stored?.[JOURNAL_KEY] as JournalMap | undefined) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  const snapshot = cache;
  if (!snapshot) return;
  writeQueue = writeQueue.then(async () => {
    try {
      await chrome.storage.session.set({ [JOURNAL_KEY]: snapshot });
    } catch {
      // Storage unavailable — journal stays in-memory for this worker's lifetime.
    }
  });
}

function trim(journal: JournalMap): void {
  const ids = Object.keys(journal);
  if (ids.length <= JOURNAL_MAX_ENTRIES) return;
  ids.sort((a, b) => journal[a].ts - journal[b].ts);
  for (const id of ids.slice(0, ids.length - JOURNAL_MAX_ENTRIES)) delete journal[id];
}

function resultByteLength(result: Result): number {
  try {
    return JSON.stringify(result).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const UNKNOWN_OUTCOME_HINT =
  'Inspect the browser/session state before retrying. Do not blindly re-run write commands such as navigate, click, type, or eval.';

/**
 * Execute a command exactly once per id. Duplicate deliveries of the same id
 * (transport retries after a dropped connection) replay the recorded outcome.
 */
export async function executeWithJournal(
  cmd: Command,
  execute: (cmd: Command) => Promise<Result>,
): Promise<Result> {
  const id = cmd.id;
  if (!id) return execute(cmd);

  const running = inFlight.get(id);
  if (running) return running;

  // Register in-flight SYNCHRONOUSLY (before any await) so a duplicate
  // arriving in the same tick attaches here instead of racing past the
  // journal check and misreading our own 'started' marker as a lost command.
  const run = (async (): Promise<Result> => {
    const journal = await load();
    const entry = journal[id];
    if (entry?.status === 'done') {
      if (entry.result) return entry.result;
      return {
        id,
        ok: false,
        errorCode: 'result_evicted',
        error: 'Command already executed, but its result was too large to record for replay.',
        errorHint: UNKNOWN_OUTCOME_HINT,
      };
    }
    if (entry?.status === 'started') {
      return {
        id,
        ok: false,
        errorCode: 'command_lost',
        error: 'Command was interrupted mid-execution (extension or browser restarted); it may or may not have applied.',
        errorHint: UNKNOWN_OUTCOME_HINT,
      };
    }

    journal[id] = { status: 'started', ts: Date.now() };
    trim(journal);
    persist();
    let result: Result;
    try {
      result = await execute(cmd);
    } catch (err) {
      result = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    journal[id] = resultByteLength(result) <= JOURNAL_RESULT_MAX_BYTES
      ? { status: 'done', ts: Date.now(), result }
      : { status: 'done', ts: Date.now() };
    persist();
    return result;
  })();

  inFlight.set(id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(id);
  }
}

export const __test__ = {
  reset(): void {
    cache = null;
    inFlight.clear();
    writeQueue = Promise.resolve();
  },
};
