/**
 * Plugin lifecycle hooks: allows plugins to tap into opencli's execution lifecycle.
 *
 * Hooks use globalThis (like the command registry) to guarantee a single shared
 * instance across all module copies — critical when TS plugins are loaded via
 * npm link / peerDependency symlinks.
 *
 * Available hooks:
 *   onStartup        — fired once after all commands & plugins are discovered
 *   onBeforeExecute  — fired before every command execution
 *   onAfterExecute   — fired after every command execution (receives result)
 */

import { log } from './logger.js';

export type HookName = 'onStartup' | 'onBeforeExecute' | 'onAfterExecute';

export interface HookContext {
  /** Command full name in "site/name" format, or "__startup__" for onStartup */
  command: string;
  /** Coerced and validated arguments */
  args: Record<string, unknown>;
  /** Epoch ms when execution started (set by executeCommand) */
  startedAt?: number;
  /** Plugins can attach arbitrary data here for cross-hook communication */
  [key: string]: unknown;
}

export type HookFn = (ctx: HookContext, result?: unknown) => void | Promise<void>;

// ── Singleton hook store (shared across module instances via globalThis) ──
declare global {
  // eslint-disable-next-line no-var
  var __opencli_hooks__: Map<HookName, HookFn[]> | undefined;
}
const _hooks: Map<HookName, HookFn[]> =
  globalThis.__opencli_hooks__ ??= new Map();

// ── Registration API (used by plugins) ─────────────────────────────────────

function addHook(name: HookName, fn: HookFn): void {
  const list = _hooks.get(name) ?? [];
  list.push(fn);
  _hooks.set(name, list);
}

/** Register a hook that fires once after all plugins are discovered. */
export function onStartup(fn: HookFn): void {
  addHook('onStartup', fn);
}

/** Register a hook that fires before every command execution. */
export function onBeforeExecute(fn: HookFn): void {
  addHook('onBeforeExecute', fn);
}

/** Register a hook that fires after every command execution with the result. */
export function onAfterExecute(fn: HookFn): void {
  addHook('onAfterExecute', fn);
}

// ── Emit API (used internally by opencli core) ─────────────────────────────

/**
 * Trigger all registered handlers for a hook.
 * Each handler is wrapped in try/catch — a failing hook never blocks command execution.
 */
export async function emitHook(name: HookName, ctx: HookContext, result?: unknown): Promise<void> {
  const handlers = _hooks.get(name);
  if (!handlers || handlers.length === 0) return;

  for (const fn of handlers) {
    try {
      await fn(ctx, result);
    } catch (err) {
      log.warn(`Hook ${name} handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Remove all registered hooks. Intended for testing only.
 */
export function clearAllHooks(): void {
  _hooks.clear();
}
