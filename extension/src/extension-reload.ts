import type { Command, Result } from './protocol';

/**
 * Reload the extension service worker only after verifying there are no active
 * commands and the acknowledgement response has been written to the socket.
 */
export function createExtensionReloader(deps: {
  ready(): Promise<void>;
  isIdle(): boolean;
  reload(): void;
  schedule(callback: () => void, delayMs: number): unknown;
}) {
  let pending: { id: string; scheduled: boolean } | null = null;

  return {
    isPending: () => pending !== null,

    async prepare(cmd: Command): Promise<Result> {
      await deps.ready();
      if (pending || !deps.isIdle()) {
        return {
          id: cmd.id,
          ok: false,
          errorCode: 'extension_reload_busy',
          error: 'The extension is busy; no reload was scheduled.',
        };
      }
      pending = { id: cmd.id, scheduled: false };
      return { id: cmd.id, ok: true, data: { reloading: true } };
    },

    acknowledge(result: Result, sent: boolean): void {
      if (!pending || pending.id !== result.id || !result.ok) return;
      if (!sent) {
        pending = null;
        return;
      }
      if (pending.scheduled) return;
      pending.scheduled = true;
      deps.schedule(() => deps.reload(), 250);
    },
  };
}
