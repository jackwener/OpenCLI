/**
 * Commander adapter: bridges Registry commands to Commander subcommands.
 *
 * This is a THIN adapter — it only handles:
 * 1. Commander arg/option registration
 * 2. Collecting kwargs from Commander's action args
 * 3. Calling executeCommand (which handles browser sessions, validation, etc.)
 * 4. Rendering output and errors
 *
 * All execution logic lives in execution.ts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { type CliCommand, fullName, getRegistry } from './registry.js';
import { formatRegistryHelpText } from './serialization.js';
import { render as renderOutput } from './output.js';
import { executeCommand } from './execution.js';
import {
  CliError,
  EXIT_CODES,
  ERROR_ICONS,
  getErrorMessage,
  BrowserConnectError,
  AuthRequiredError,
  TimeoutError,
  SelectorError,
  EmptyResultError,
  ArgumentError,
  AdapterLoadError,
  CommandExecutionError,
} from './errors.js';
import { getDaemonHealth } from './browser/daemon-client.js';
import { MAYBE_BROWSER_SCRAPER_ID } from './browser/extension-detect.js';
import { isDiagnosticEnabled } from './diagnostic.js';

export function normalizeArgValue(argType: string | undefined, value: unknown, name: string): unknown {
  if (argType !== 'bool' && argType !== 'boolean') return value;
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return false;

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  throw new ArgumentError(`"${name}" must be either "true" or "false".`);
}

/**
 * Register a single CliCommand as a Commander subcommand.
 */
export function registerCommandToProgram(siteCmd: Command, cmd: CliCommand): void {
  if (siteCmd.commands.some((c: Command) => c.name() === cmd.name)) return;

  const deprecatedSuffix = cmd.deprecated ? ' [deprecated]' : '';
  const subCmd = siteCmd.command(cmd.name).description(`${cmd.description}${deprecatedSuffix}`);
  if (cmd.aliases?.length) subCmd.aliases(cmd.aliases);

  // Register positional args first, then named options
  const positionalArgs: typeof cmd.args = [];
  for (const arg of cmd.args) {
    if (arg.positional) {
      const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
      subCmd.argument(bracket, arg.help ?? '');
      positionalArgs.push(arg);
    } else {
      const expectsValue = arg.required || arg.valueRequired;
      const flag = expectsValue ? `--${arg.name} <value>` : `--${arg.name} [value]`;
      if (arg.required) subCmd.requiredOption(flag, arg.help ?? '');
      else if (arg.default != null) subCmd.option(flag, arg.help ?? '', String(arg.default));
      else subCmd.option(flag, arg.help ?? '');
    }
  }
  subCmd
    .option('-f, --format <fmt>', 'Output format: table, plain, json, yaml, md, csv', 'table')
    .option('-v, --verbose', 'Debug output', false);

  subCmd.addHelpText('after', formatRegistryHelpText(cmd));

  subCmd.action(async (...actionArgs: unknown[]) => {
    const actionOpts = actionArgs[positionalArgs.length] ?? {};
    const optionsRecord = typeof actionOpts === 'object' && actionOpts !== null ? actionOpts as Record<string, unknown> : {};
    const startTime = Date.now();

    // ── Execute + render ────────────────────────────────────────────────
    try {
      // ── Collect kwargs ────────────────────────────────────────────────
      const kwargs: Record<string, unknown> = {};
      for (let i = 0; i < positionalArgs.length; i++) {
        const v = actionArgs[i];
        if (v !== undefined) kwargs[positionalArgs[i].name] = v;
      }
      for (const arg of cmd.args) {
        if (arg.positional) continue;
        const camelName = arg.name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
        const v = optionsRecord[arg.name] ?? optionsRecord[camelName];
        if (v !== undefined) kwargs[arg.name] = normalizeArgValue(arg.type, v, arg.name);
      }
      cmd.validateArgs?.(kwargs);

      const verbose = optionsRecord.verbose === true;
      let format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
      const formatExplicit = subCmd.getOptionValueSource('format') === 'cli';
      if (verbose) process.env.OPENCLI_VERBOSE = '1';
      if (cmd.deprecated) {
        const message = typeof cmd.deprecated === 'string' ? cmd.deprecated : `${fullName(cmd)} is deprecated.`;
        const replacement = cmd.replacedBy ? ` Use ${cmd.replacedBy} instead.` : '';
        console.error(chalk.yellow(`Deprecated: ${message}${replacement}`));
      }

      const result = await executeCommand(cmd, kwargs, verbose);
      if (result === null || result === undefined) {
        return;
      }

      const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
      if (!formatExplicit && format === 'table' && resolved.defaultFormat) {
        format = resolved.defaultFormat;
      }

      if (verbose && (!result || (Array.isArray(result) && result.length === 0))) {
        console.error(chalk.yellow('[Verbose] Warning: Command returned an empty result.'));
      }
      renderOutput(result, {
        fmt: format,
        fmtExplicit: formatExplicit,
        columns: resolved.columns,
        title: `${resolved.site}/${resolved.name}`,
        elapsed: (Date.now() - startTime) / 1000,
        source: fullName(resolved),
        footerExtra: resolved.footerExtra?.(kwargs),
      });
    } catch (err) {
      await renderError(err, fullName(cmd), optionsRecord.verbose === true);
      process.exitCode = resolveExitCode(err);
    }
  });
}

// ── Error classification ─────────────────────────────────────────────────────

const ISSUES_URL = 'https://github.com/jackwener/opencli/issues';

export type GenericErrorKind = 'auth' | 'http' | 'not-found' | 'other';

interface ClassifiedError {
  kind: GenericErrorKind;
  icon: string;
  exitCode: number;
  hint: string;
}

const GENERIC_ERROR_MAP: Record<GenericErrorKind, Omit<ClassifiedError, 'kind'>> = {
  auth:        { icon: '🔒', exitCode: EXIT_CODES.NOPERM,        hint: 'Open Chrome or Chromium, log in to the target site, then retry.' },
  http:        { icon: '🌐', exitCode: EXIT_CODES.GENERIC_ERROR, hint: 'Check your login status, or the site may be temporarily unavailable.' },
  'not-found': { icon: '📭', exitCode: EXIT_CODES.EMPTY_RESULT,  hint: 'The resource was not found. The adapter or page structure may have changed.' },
  other:       { icon: '💥', exitCode: EXIT_CODES.GENERIC_ERROR, hint: '' },
};

/** Pattern-based classifier for untyped errors thrown by adapters. */
function classifyGenericError(msg: string): ClassifiedError {
  const m = msg.toLowerCase();
  let kind: GenericErrorKind = 'other';
  if (/not logged in|login required|please log in|未登录|请先登录|authentication required|cookie expired/.test(m)) kind = 'auth';
  else if (/\b(status[: ]+)?[45]\d{2}\b|http[/ ][45]\d{2}/.test(m)) kind = 'http';
  else if (/not found|未找到|could not find|no .+ found/.test(m)) kind = 'not-found';
  return { kind, ...GENERIC_ERROR_MAP[kind] };
}

// ── Exit code resolution ─────────────────────────────────────────────────────

function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;
  return classifyGenericError(getErrorMessage(err)).exitCode;
}

/** Render a status line for BrowserConnectError based on real-time or kind-derived state. */
function renderBridgeStatus(running: boolean, extensionConnected: boolean): void {
  const ok = chalk.green('✓');
  const fail = chalk.red('✗');
  console.error(`  Daemon    ${running ? ok : fail} ${running ? 'running' : 'not running'}`);
  console.error(`  Extension ${extensionConnected ? ok : fail} ${extensionConnected ? 'connected' : 'not connected'}`);
  console.error();
  if (!running) {
    console.error(chalk.yellow('  Run the command again — daemon should auto-start.'));
    console.error(chalk.dim('  Still failing? Run: opencli doctor'));
  } else if (!extensionConnected) {
    console.error(chalk.yellow('  Install the Browser Bridge extension to continue:'));
    console.error(chalk.dim('    1. Download from github.com/jackwener/opencli/releases'));
    console.error(chalk.dim('    2. chrome://extensions → Enable Developer Mode → Load unpacked'));
    console.error(chalk.dim(`    3. Confirm extension ID: ${MAYBE_BROWSER_SCRAPER_ID}`));
  } else {
    console.error(chalk.yellow('  Connection failed despite extension being active.'));
    console.error(chalk.dim('  Try reloading the extension, or run: opencli doctor'));
  }
}

/** Emit AutoFix hint for repairable adapter errors (skipped if already in diagnostic mode). */
function emitAutoFixHint(cmdName: string): void {
  if (isDiagnosticEnabled()) return; // Already collecting diagnostics, don't repeat
  console.error();
  console.error(chalk.cyan('💡 AutoFix: re-run with OPENCLI_DIAGNOSTIC=1 for repair context.'));
  console.error(chalk.dim(`    OPENCLI_DIAGNOSTIC=1 ${cmdName}`));
}

async function renderError(err: unknown, cmdName: string, verbose: boolean): Promise<void> {
  // ── BrowserConnectError: real-time diagnosis, kind as fallback ────────
  if (err instanceof BrowserConnectError) {
    console.error(chalk.red(`🔌 ${err.message}`));
    if (err.hint) console.error(chalk.yellow(`→ ${err.hint}`));
    console.error();
    try {
      const health = await getDaemonHealth({ timeout: 300 });
      renderBridgeStatus(health.state !== 'stopped', health.state === 'ready');
    } catch (_statusErr) {
      // getDaemonHealth itself failed — derive best-guess state from kind.
      const running = err.kind !== 'daemon-not-running';
      const extensionConnected = err.kind === 'command-failed';
      renderBridgeStatus(running, extensionConnected);
    }
    return;
  }

  // ── AuthRequiredError ─────────────────────────────────────────────────
  if (err instanceof AuthRequiredError) {
    console.error(chalk.red(`🔒 Not logged in to ${err.domain}`));
    // Respect custom hints set by the adapter; fall back to generic guidance.
    console.error(chalk.yellow(`→ ${err.hint ?? `Open Chrome or Chromium and log in to https://${err.domain}, then retry.`}`));
    return;
  }

  // ── TimeoutError ──────────────────────────────────────────────────────
  if (err instanceof TimeoutError) {
    console.error(chalk.red(`⏱  ${err.message}`));
    console.error(chalk.yellow('→ Try again, or raise the limit:'));
    console.error(chalk.dim(`    OPENCLI_BROWSER_COMMAND_TIMEOUT=60 ${cmdName}`));
    return;
  }

  // ── SelectorError / EmptyResultError: likely outdated adapter ─────────
  if (err instanceof SelectorError || err instanceof EmptyResultError) {
    const icon = ERROR_ICONS[err.code] ?? '⚠️';
    console.error(chalk.red(`${icon} ${err.message}`));
    console.error(chalk.yellow(`→ ${err.hint ?? 'The page structure may have changed — this adapter may be outdated.'}`));
    console.error(chalk.dim(`  Debug:  ${cmdName} --verbose`));
    console.error(chalk.dim(`  Report: ${ISSUES_URL}`));
    emitAutoFixHint(cmdName);
    return;
  }

  // ── ArgumentError ─────────────────────────────────────────────────────
  if (err instanceof ArgumentError) {
    console.error(chalk.red(`❌ ${err.message}`));
    if (err.hint) console.error(chalk.yellow(`→ ${err.hint}`));
    return;
  }

  // ── AdapterLoadError ──────────────────────────────────────────────────
  if (err instanceof AdapterLoadError) {
    console.error(chalk.red(`📦 ${err.message}`));
    if (err.hint) console.error(chalk.yellow(`→ ${err.hint}`));
    return;
  }

  // ── CommandExecutionError ─────────────────────────────────────────────
  if (err instanceof CommandExecutionError) {
    console.error(chalk.red(`💥 ${err.message}`));
    if (err.hint) {
      console.error(chalk.yellow(`→ ${err.hint}`));
    } else {
      console.error(chalk.dim(`  Add --verbose for details, or report: ${ISSUES_URL}`));
    }
    return;
  }

  // ── Other typed CliError (fallback for future codes) ──────────────────
  if (err instanceof CliError) {
    const icon = ERROR_ICONS[err.code] ?? '⚠️';
    console.error(chalk.red(`${icon} ${err.message}`));
    if (err.hint) console.error(chalk.yellow(`→ ${err.hint}`));
    return;
  }

  // ── Generic Error from adapters: classify by message pattern ──────────
  const msg = getErrorMessage(err);
  const classified = classifyGenericError(msg);

  if (classified.kind !== 'other') {
    console.error(chalk.red(`${classified.icon} ${msg}`));
    console.error(chalk.yellow(`→ ${classified.hint}`));
    if (classified.kind === 'not-found') console.error(chalk.dim(`  Report: ${ISSUES_URL}`));
    if (classified.kind === 'not-found') emitAutoFixHint(cmdName);
    return;
  }

  // ── Unknown error: show stack in verbose mode ─────────────────────────
  if (verbose && err instanceof Error && err.stack) {
    console.error(chalk.red(err.stack));
  } else {
    console.error(chalk.red(`💥 Unexpected error: ${msg}`));
    console.error(chalk.dim(`  Run with --verbose for details, or report: ${ISSUES_URL}`));
  }
}

/**
 * Register all commands from the registry onto a Commander program.
 */
export function registerAllCommands(
  program: Command,
  siteGroups: Map<string, Command>,
): void {
  const seen = new Set<CliCommand>();
  for (const [, cmd] of getRegistry()) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    let siteCmd = siteGroups.get(cmd.site);
    if (!siteCmd) {
      siteCmd = program.command(cmd.site).description(`${cmd.site} commands`);
      siteGroups.set(cmd.site, siteCmd);
    }
    registerCommandToProgram(siteCmd, cmd);
  }
}
