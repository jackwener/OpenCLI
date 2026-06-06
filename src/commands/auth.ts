import { pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError, Option } from 'commander';
import { AuthRequiredError, CliError, getErrorMessage } from '../errors.js';
import { executeCommand } from '../execution.js';
import {
  type BrowserCliCommand,
  type CliCommand,
  type CommandArgs,
  type InternalCliCommand,
  fullName,
  getRegistry,
} from '../registry.js';
import { render as renderOutput } from '../output.js';

type AuthStatus = 'logged_in' | 'not_logged_in' | 'unknown' | 'error';
type AuthStatusMode = 'quick' | 'full';

export interface AuthStatusRow {
  site: string;
  status: AuthStatus;
  logged_in: boolean | '';
  identity: string;
  checked: AuthStatusMode | 'skipped';
  error: string;
}

interface AuthStatusOptions {
  sites?: string;
  only?: string;
  full?: boolean;
  concurrency?: string | number;
  timeout?: string | number;
  profile?: string;
}

function parsePositiveInt(raw: string | number | undefined, label: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${label} must be a positive integer. Received: "${String(raw)}"`);
  }
  return parsed;
}

function parseSiteFilter(raw: string | undefined): Set<string> | null {
  if (!raw || !raw.trim()) return null;
  const sites = raw.split(',').map(site => site.trim()).filter(Boolean);
  return sites.length > 0 ? new Set(sites) : null;
}

function authWhoamiCommands(): CliCommand[] {
  const seen = new Set<CliCommand>();
  return [...getRegistry().values()]
    .filter((cmd) => {
      if (seen.has(cmd)) return false;
      seen.add(cmd);
      return cmd.name === 'whoami' && cmd.browser === true && cmd.access === 'read';
    })
    .sort((a, b) => a.site.localeCompare(b.site));
}

async function loadLazyCommand(cmd: CliCommand): Promise<CliCommand> {
  const internal = cmd as InternalCliCommand;
  if (!internal._lazy || !internal._modulePath) return cmd;
  await import(pathToFileURL(internal._modulePath).href);
  return getRegistry().get(fullName(cmd)) ?? cmd;
}

function withTimeoutArg(cmd: CliCommand, timeoutSeconds: number): CliCommand {
  const hasTimeout = cmd.args.some(arg => arg.name === 'timeout');
  return {
    ...cmd,
    args: hasTimeout
      ? cmd.args
      : [...cmd.args, { name: 'timeout', type: 'int', default: timeoutSeconds, help: 'Per-site auth status timeout in seconds' }],
  };
}

function quickCheckCommand(cmd: CliCommand, timeoutSeconds: number): BrowserCliCommand | null {
  if (cmd.browser !== true || typeof cmd.authStatus?.quickCheck !== 'function') return null;
  return withTimeoutArg({
    ...cmd,
    func: cmd.authStatus.quickCheck,
    navigateBefore: false,
    siteSession: 'ephemeral',
    defaultWindowMode: 'background',
  }, timeoutSeconds) as BrowserCliCommand;
}

function normalizeQuickResult(result: unknown): boolean | null {
  if (typeof result === 'boolean') return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const value = (result as Record<string, unknown>).logged_in;
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function safeIdentityValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function identitySummary(result: unknown): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const row = result as Record<string, unknown>;
  const blocked = /(?:email|phone|real.?name|first.?name|last.?name|cookie|token|session|secret|password|csrf|jwt|bearer|wt2)/i;
  for (const key of ['username', 'handle', 'user_id', 'id', 'name', 'nickname', 'user_type', 'url']) {
    if (blocked.test(key)) continue;
    const value = safeIdentityValue(row[key]);
    if (value) return value;
  }
  for (const [key, raw] of Object.entries(row)) {
    if (key === 'site' || key === 'logged_in' || blocked.test(key)) continue;
    const value = safeIdentityValue(raw);
    if (value) return value;
  }
  return '';
}

function rowForError(site: string, checked: AuthStatusMode, error: unknown): AuthStatusRow {
  if (error instanceof AuthRequiredError) {
    return { site, status: 'not_logged_in', logged_in: false, identity: '', checked, error: '' };
  }
  const code = error instanceof CliError ? error.code : '';
  const message = getErrorMessage(error);
  return {
    site,
    status: 'error',
    logged_in: '',
    identity: '',
    checked,
    error: code ? `${code}: ${message}` : message,
  };
}

async function runQuick(cmd: CliCommand, opts: { timeoutSeconds: number; profile?: string }): Promise<AuthStatusRow> {
  const loaded = await loadLazyCommand(cmd);
  const quickCmd = quickCheckCommand(loaded, opts.timeoutSeconds);
  if (!quickCmd) {
    return {
      site: cmd.site,
      status: 'unknown',
      logged_in: '',
      identity: '',
      checked: 'skipped',
      error: 'quickCheck not implemented; use --full to run whoami',
    };
  }

  try {
    const result = await executeCommand(quickCmd, { timeout: opts.timeoutSeconds } as CommandArgs, false, {
      siteSession: 'ephemeral',
      keepTab: 'false',
      windowMode: 'background',
      ...(opts.profile ? { profile: opts.profile } : {}),
    });
    const loggedIn = normalizeQuickResult(result);
    if (loggedIn === true) {
      return { site: cmd.site, status: 'logged_in', logged_in: true, identity: '', checked: 'quick', error: '' };
    }
    if (loggedIn === false) {
      return { site: cmd.site, status: 'not_logged_in', logged_in: false, identity: '', checked: 'quick', error: '' };
    }
    return {
      site: cmd.site,
      status: 'unknown',
      logged_in: '',
      identity: '',
      checked: 'quick',
      error: 'quickCheck returned no boolean logged_in signal',
    };
  } catch (error) {
    return rowForError(cmd.site, 'quick', error);
  }
}

async function runFull(cmd: CliCommand, opts: { timeoutSeconds: number; profile?: string }): Promise<AuthStatusRow> {
  const loaded = await loadLazyCommand(cmd);
  const fullCmd = withTimeoutArg(loaded, opts.timeoutSeconds);
  try {
    const result = await executeCommand(fullCmd, { timeout: opts.timeoutSeconds } as CommandArgs, false, {
      siteSession: 'ephemeral',
      keepTab: 'false',
      windowMode: 'background',
      ...(opts.profile ? { profile: opts.profile } : {}),
    });
    return {
      site: cmd.site,
      status: 'logged_in',
      logged_in: true,
      identity: identitySummary(result),
      checked: 'full',
      error: '',
    };
  } catch (error) {
    return rowForError(cmd.site, 'full', error);
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function collectAuthStatus(options: AuthStatusOptions): Promise<AuthStatusRow[]> {
  const selectedSites = parseSiteFilter(options.sites);
  const mode: AuthStatusMode = options.full ? 'full' : 'quick';
  const concurrency = parsePositiveInt(options.concurrency, '--concurrency', mode === 'full' ? 3 : 8);
  const timeoutSeconds = parsePositiveInt(options.timeout, '--timeout', mode === 'full' ? 20 : 8);
  const only = String(options.only ?? 'all');
  if (!['all', 'logged-in', 'not-logged-in', 'unknown', 'error'].includes(only)) {
    throw new InvalidArgumentError('--only must be one of: all, logged-in, not-logged-in, unknown, error');
  }

  const commands = authWhoamiCommands().filter(cmd => !selectedSites || selectedSites.has(cmd.site));
  const rows = await mapConcurrent(commands, concurrency, cmd => (
    mode === 'full'
      ? runFull(cmd, { timeoutSeconds, profile: options.profile })
      : runQuick(cmd, { timeoutSeconds, profile: options.profile })
  ));

  const normalizedOnly = only.replace(/-/g, '_');
  return normalizedOnly === 'all'
    ? rows
    : rows.filter(row => row.status === normalizedOnly);
}

export function registerAuthCommands(program: Command): Command {
  const auth = program
    .command('auth')
    .description('Inspect website login status');

  const status = auth
    .command('status')
    .description('Show login status for sites with auth adapters')
    .option('--site <sites>', 'Comma-separated site names to check, e.g. github,chatgpt')
    .option('--full', 'Run full per-site whoami probes instead of quick no-navigation checks', false)
    .option('--concurrency <n>', 'Maximum sites to check at once')
    .option('--timeout <seconds>', 'Per-site timeout in seconds')
    .addOption(new Option('--only <status>', 'Filter rows by status').choices(['all', 'logged-in', 'not-logged-in', 'unknown', 'error']).default('all'))
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .action(async (opts) => {
      const globals = typeof status.optsWithGlobals === 'function' ? status.optsWithGlobals() as Record<string, unknown> : {};
      const rows = await collectAuthStatus({
        sites: opts.site,
        full: opts.full === true,
        concurrency: opts.concurrency,
        timeout: opts.timeout,
        only: opts.only,
        profile: typeof globals.profile === 'string' && globals.profile.trim() ? globals.profile.trim() : undefined,
      });
      const fmt = typeof opts.format === 'string' ? opts.format : 'table';
      renderOutput(rows, {
        fmt,
        fmtExplicit: status.getOptionValueSource('format') === 'cli',
        columns: ['site', 'status', 'identity', 'checked', 'error'],
        title: 'opencli/auth status',
        source: opts.full ? 'full whoami probe' : 'quick auth check',
      });
    });

  return auth;
}
