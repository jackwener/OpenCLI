/**
 * Public API for opencli plugins.
 *
 * TS plugins should import from '@jackwener/opencli/registry' which resolves to
 * this file. It re-exports ONLY the core registration API — no serialization,
 * no transitive side-effects — to avoid circular dependency deadlocks when
 * plugins are dynamically imported during discoverPlugins().
 */

export { cli, Strategy, getRegistry, fullName, registerCommand } from './registry.js';
export type { CliCommand, Arg, CliOptions, CommandArgs, BrowserSessionOptions, BrowserSessionReuse } from './registry.js';
export type { IPage } from './types.js';
export { onStartup, onBeforeExecute, onAfterExecute } from './hooks.js';
export type { HookFn, HookContext, HookName } from './hooks.js';
