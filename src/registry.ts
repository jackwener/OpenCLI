/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */

import type { IPage } from './types.js';

export enum Strategy {
  PUBLIC = 'public',
  LOCAL = 'local',
  COOKIE = 'cookie',
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

export type CommandArgs = Record<string, any>;
export type BrowserCommandFunc = (page: IPage, kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
export type NonBrowserCommandFunc = (kwargs: CommandArgs, debug?: boolean) => Promise<unknown>;
export type CommandAccess = 'read' | 'write';
export type BrowserSessionReuse = 'none' | 'site';

export interface BrowserSessionOptions {
  /**
   * Control whether browser-backed adapter commands reuse a stable tab lease.
   *
   * - `none`: one-shot workspace per command execution (default)
   * - `site`: all commands for this site share `site:<site>` until idle expiry
   */
  reuse?: BrowserSessionReuse;
}

interface BaseCliCommand {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  access: CommandAccess;
  /** Canonical invocation shown in agent-facing help. Generated when omitted. */
  example?: string;
  domain?: string;
  strategy?: Strategy;
  args: Arg[];
  columns?: string[];
  pipeline?: Record<string, unknown>[];
  /** Origin of this command: 'yaml', 'ts', or plugin name. */
  source?: string;
  footerExtra?: (kwargs: CommandArgs) => string | undefined;
  validateArgs?: (kwargs: CommandArgs) => void;
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
   *
   * Adapter authors can set this explicitly to override the strategy-based default.
   */
  navigateBefore?: boolean | string;
  /** Browser session lifecycle defaults for adapter commands. */
  browserSession?: BrowserSessionOptions;
  /** Override the default CLI output format when the user does not pass -f/--format. */
  defaultFormat?: 'table' | 'plain' | 'json' | 'yaml' | 'yml' | 'md' | 'markdown' | 'csv';
}

export interface BrowserCliCommand extends BaseCliCommand {
  /** Browser commands receive an IPage. Omitted means true after normalization. */
  browser?: true;
  func?: BrowserCommandFunc;
}

export interface NonBrowserCliCommand extends BaseCliCommand {
  /** Non-browser commands do not receive a page argument. */
  browser: false;
  func?: NonBrowserCommandFunc;
}

export type CliCommand = BrowserCliCommand | NonBrowserCliCommand;
type RawCliCommand = BaseCliCommand & {
  browser?: boolean;
  func?: BrowserCommandFunc | NonBrowserCommandFunc;
};

/** Internal extension for lazy-loaded TS modules (not exposed in public API) */
export type InternalCliCommand = CliCommand & {
  _lazy?: boolean;
  _modulePath?: string;
};

type RequiredCliOptions = {
  site: string;
  name: string;
  access: CommandAccess;
  description?: string;
  args?: Arg[];
};

type BrowserStrategy = Exclude<Strategy, Strategy.PUBLIC | Strategy.LOCAL>;
type BrowserCliOptions = Partial<Omit<BrowserCliCommand, 'args' | 'description' | 'browser' | 'strategy'>> & RequiredCliOptions & (
  | { browser: true; strategy?: Strategy }
  | { browser?: true; strategy?: BrowserStrategy }
);
type NonBrowserCliOptions = Partial<Omit<NonBrowserCliCommand, 'args' | 'description'>> & RequiredCliOptions & (
  | { browser: false }
  | { strategy: Strategy.PUBLIC | Strategy.LOCAL; browser?: false }
);

export type CliOptions = BrowserCliOptions | NonBrowserCliOptions;

// Use globalThis to ensure a single shared registry across all module instances.
// This is critical for TS plugins loaded via npm link / peerDependency — without
// this, the plugin's import creates a separate module instance with its own Map.
declare global { var __opencli_registry__: Map<string, CliCommand> | undefined; }
const _registry: Map<string, CliCommand> =
  globalThis.__opencli_registry__ ??= new Map<string, CliCommand>();

export function cli(opts: CliOptions): CliCommand {
  const cmd: RawCliCommand = {
    site: opts.site,
    name: opts.name,
    aliases: opts.aliases,
    description: opts.description ?? '',
    access: opts.access,
    example: opts.example,
    domain: opts.domain,
    strategy: opts.strategy,
    browser: opts.browser,
    args: opts.args ?? [],
    columns: opts.columns,
    func: opts.func,
    pipeline: opts.pipeline,
    footerExtra: opts.footerExtra,
    navigateBefore: opts.navigateBefore,
    browserSession: opts.browserSession,
    defaultFormat: opts.defaultFormat,
  };

  registerCommand(cmd);
  return _registry.get(fullName(cmd))!;
}

export function getRegistry(): Map<string, CliCommand> {
  return _registry;
}

export function fullName(cmd: Pick<BaseCliCommand, 'site' | 'name'>): string {
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
function normalizeCommand(cmd: RawCliCommand): CliCommand {
  assertCommandAccess(cmd);
  assertBrowserSessionOptions(cmd);

  const strategy = cmd.strategy ?? (cmd.browser === false ? Strategy.PUBLIC : Strategy.COOKIE);
  const browser = cmd.browser ?? (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL);

  let navigateBefore = cmd.navigateBefore;
  if (navigateBefore === undefined) {
    if (strategy === Strategy.COOKIE && cmd.domain) {
      navigateBefore = `https://${cmd.domain}`;
    } else if (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL) {
      // Non-PUBLIC without domain: needs authenticated browser context
      // but no specific pre-navigation URL. `true` signals this to
      // shouldUseBrowserSession without triggering resolvePreNav.
      navigateBefore = true;
    }
  }

  return browser
    ? { ...cmd, strategy, browser: true, navigateBefore } as BrowserCliCommand
    : { ...cmd, strategy, browser: false, navigateBefore } as NonBrowserCliCommand;
}

function assertCommandAccess(cmd: Pick<RawCliCommand, 'site' | 'name'> & { access?: unknown }): asserts cmd is RawCliCommand {
  if (cmd.access === 'read' || cmd.access === 'write') return;
  const key = `${cmd.site}/${cmd.name}`;
  throw new Error(`Command ${key} must declare access: 'read' | 'write'`);
}

function assertBrowserSessionOptions(cmd: Pick<RawCliCommand, 'site' | 'name'> & { browserSession?: unknown }): void {
  if (cmd.browserSession === undefined) return;
  const key = `${cmd.site}/${cmd.name}`;
  if (cmd.browserSession === null || typeof cmd.browserSession !== 'object' || Array.isArray(cmd.browserSession)) {
    throw new Error(`Command ${key} browserSession must be an object`);
  }
  const reuse = (cmd.browserSession as BrowserSessionOptions).reuse;
  if (reuse !== undefined && reuse !== 'none' && reuse !== 'site') {
    throw new Error(`Command ${key} browserSession.reuse must be one of: none, site`);
  }
}

export function registerCommand(cmd: RawCliCommand): void {
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
