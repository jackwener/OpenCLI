/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */

import type { IPage } from './types.js';

export enum Strategy {
  PUBLIC = 'public',
  LOCAL = 'local',
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

export type CommandArgs = Record<string, any>;

/**
 * Options for navigateBefore when fine-grained control is needed.
 *
 * Useful for heavy SPAs where the default `waitUntil: 'load'` + 1s settle
 * causes timeouts, or when a cookie-seeding navigation to a different
 * subdomain is required before loading the actual target page.
 */
export interface PreNavOptions {
  /** Primary URL to navigate to. */
  url: string;
  /** Override waitUntil behavior ('load' or 'none'). Default: 'load'. */
  waitUntil?: 'load' | 'none';
  /** Milliseconds to wait for DOM stability after load. Default: 1000. */
  settleMs?: number;
}

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
   * Control pre-navigation and browser-session requirement.
   *
   * After normalizeCommand() expands strategy, this field carries the
   * resolved runtime intent:
   *
   * - `undefined`: no pre-navigation, browser session decided by pipeline steps
   * - `false`: explicitly skip pre-navigation (adapter handles its own navigation)
   * - `true`: needs authenticated browser context but no specific pre-nav URL
   *   (e.g. INTERCEPT/UI adapters, or COOKIE without domain)
   * - `string`: pre-navigate to this URL before running the adapter
   *   (e.g. `'https://x.com'` for COOKIE strategy with domain)
   * - `object`: pre-navigate with explicit waitUntil / settleMs controls
   *
   * Adapter authors can set this explicitly to override the strategy-based default.
   */
  navigateBefore?: boolean | string | PreNavOptions;
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
  const cmd: CliCommand = {
    site: opts.site,
    name: opts.name,
    aliases: opts.aliases,
    description: opts.description ?? '',
    domain: opts.domain,
    strategy: opts.strategy,
    browser: opts.browser,
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
  return _registry.get(fullName(cmd))!;
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

/**
 * Normalize a command's runtime fields. This is the single place where
 * `strategy` is decoded into the concrete fields that the execution path
 * reads (`browser`, `navigateBefore`). After normalization, execution code
 * (resolvePreNav, shouldUseBrowserSession) never reads `cmd.strategy`.
 *
 * `strategy` itself is preserved as metadata for `opencli list`, cascade
 * probe, adapter generation, and human documentation.
 *
 * Override priority (highest wins):
 *   1. Explicit field on the command (`browser: false`, `navigateBefore: false`)
 *   2. Derived from strategy + domain (the defaults below)
 */
function normalizeCommand(cmd: CliCommand): CliCommand {
  const strategy = cmd.strategy ?? (cmd.browser === false ? Strategy.PUBLIC : Strategy.COOKIE);
  const browser = cmd.browser ?? (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL);

  let navigateBefore = cmd.navigateBefore;
  if (navigateBefore === undefined) {
    if ((strategy === Strategy.COOKIE || strategy === Strategy.HEADER) && cmd.domain) {
      navigateBefore = `https://${cmd.domain}`;
    } else if (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL) {
      // Non-PUBLIC without domain: needs authenticated browser context
      // but no specific pre-navigation URL. `true` signals this to
      // shouldUseBrowserSession without triggering resolvePreNav.
      navigateBefore = true;
    }
  }

  return { ...cmd, strategy, browser, navigateBefore };
}

export function registerCommand(cmd: CliCommand): void {
  const normalized = normalizeCommand(cmd);
  const canonicalKey = fullName(normalized);
  const existing = _registry.get(canonicalKey);
  if (existing?.aliases) {
    for (const alias of existing.aliases) {
      _registry.delete(`${existing.site}/${alias}`);
    }
  }

  const aliases = normalizeAliases(normalized.aliases, normalized.name);
  normalized.aliases = aliases.length > 0 ? aliases : undefined;
  _registry.set(canonicalKey, normalized);
  for (const alias of aliases) {
    _registry.set(`${normalized.site}/${alias}`, normalized);
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
