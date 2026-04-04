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
  valueRequired?: boolean;
  positional?: boolean;
  help?: string;
  choices?: string[];
}

export interface RequiredEnv {
  name: string;
  help?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- kwargs from CLI parsing are inherently untyped
export type CommandArgs = Record<string, any>;

export interface CliCommand {
  site: string;
  name: string;
  aliases?: string[];
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
  requiredEnv?: RequiredEnv[];
  validateArgs?: (kwargs: CommandArgs) => void;
  /** Deprecation note shown in help / execution warnings. */
  deprecated?: boolean | string;
  /** Preferred replacement command, if any. */
  replacedBy?: string;
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
  /** Override the default CLI output format when the user does not pass -f/--format. */
  defaultFormat?: 'table' | 'plain' | 'json' | 'yaml' | 'yml' | 'md' | 'markdown' | 'csv';
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
  const aliases = normalizeAliases(opts.aliases, opts.name);
  const cmd: CliCommand = {
    site: opts.site,
    name: opts.name,
    aliases,
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
    requiredEnv: opts.requiredEnv,
    deprecated: opts.deprecated,
    replacedBy: opts.replacedBy,
    navigateBefore: opts.navigateBefore,
    defaultFormat: opts.defaultFormat,
  };

  registerCommand(cmd);
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
  const canonicalKey = fullName(cmd);
  const existing = _registry.get(canonicalKey);
  if (existing) {
    for (const [key, value] of _registry.entries()) {
      if (value === existing && key !== canonicalKey) _registry.delete(key);
    }
  }

  const aliases = normalizeAliases(cmd.aliases, cmd.name);
  cmd.aliases = aliases.length > 0 ? aliases : undefined;
  _registry.set(canonicalKey, cmd);
  for (const alias of aliases) {
    _registry.set(`${cmd.site}/${alias}`, cmd);
  }
}

function normalizeAliases(aliases: string[] | undefined, commandName: string): string[] {
  if (!Array.isArray(aliases) || aliases.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const alias of aliases) {
    const value = typeof alias === 'string' ? alias.trim() : '';
    if (!value || value === commandName || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}
