/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */

import type { IPage } from './types.js';

export enum Strategy {
  PUBLIC = 'public',
  COOKIE = 'cookie',
  HEADER = 'header',
  INTERCEPT = 'intercept',
  UI = 'ui',
}

export interface Arg {
  name: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  positional?: boolean;
  help?: string;
  choices?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kwargs from CLI parsing are inherently untyped
export type CommandArgs = Record<string, any>;

export interface CliCommand {
  site: string;
  name: string;
  description: string;
  domain?: string;
  strategy?: Strategy;
  browser?: boolean;
  args: Arg[];
  columns?: string[];
  func?: (page: IPage, kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
  pipeline?: Record<string, unknown>[];
  timeoutSeconds?: number;
  /** Origin of this command: 'yaml', 'ts', or plugin name. */
  source?: string;
  footerExtra?: (kwargs: CommandArgs) => string | undefined;
  /**
   * Control pre-navigation for cookie/header context before command execution.
   *
   * Browser adapters using COOKIE/HEADER strategy need the page to be on the
   * target domain so that `fetch(url, { credentials: 'include' })` carries cookies.
   *
   * - `undefined` / `true`: navigate to `https://${domain}` (default)
   * - `false`: skip — adapter handles its own navigation (e.g. boss common.ts)
   * - `string`: navigate to this specific URL instead of the domain root
   */
  navigateBefore?: boolean | string;
}

/** Internal extension for lazy-loaded TS modules (not exposed in public API) */
export interface InternalCliCommand extends CliCommand {
  _lazy?: boolean;
  _modulePath?: string;
}
export interface CliOptions extends Partial<Omit<CliCommand, 'args' | 'description'>> {
  site: string;
  name: string;
  description?: string;
  args?: Arg[];
}

// Use globalThis to ensure a single shared registry across all module instances.
// This is critical for TS plugins loaded via npm link / peerDependency — without
// this, the plugin's import creates a separate module instance with its own Map.
declare global { var __opencli_registry__: Map<string, CliCommand> | undefined; }
const _registry: Map<string, CliCommand> =
  globalThis.__opencli_registry__ ??= new Map<string, CliCommand>();

export function cli(opts: CliOptions): CliCommand {
  const strategy = opts.strategy ?? (opts.browser === false ? Strategy.PUBLIC : Strategy.COOKIE);
  const browser = opts.browser ?? (strategy !== Strategy.PUBLIC);
  const cmd: CliCommand = {
    site: opts.site,
    name: opts.name,
    description: opts.description ?? '',
    domain: opts.domain,
    strategy,
    browser,
    args: opts.args ?? [],
    columns: opts.columns,
    func: opts.func,
    pipeline: opts.pipeline,
    timeoutSeconds: opts.timeoutSeconds,
    footerExtra: opts.footerExtra,
    navigateBefore: opts.navigateBefore,
  };

  const key = fullName(cmd);
  _registry.set(key, cmd);
  return cmd;
}

export function getRegistry(): Map<string, CliCommand> {
  return _registry;
}

export function fullName(cmd: CliCommand): string {
  return `${cmd.site}/${cmd.name}`;
}

export function strategyLabel(cmd: CliCommand): string {
  return cmd.strategy ?? Strategy.PUBLIC;
}

export function registerCommand(cmd: CliCommand): void {
  _registry.set(fullName(cmd), cmd);
}


