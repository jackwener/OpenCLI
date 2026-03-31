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
import { checkDaemonStatus } from './browser/discover.js';

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

  // Register positional args first, then named options
  const positionalArgs: typeof cmd.args = [];
  for (const arg of cmd.args) {
    if (arg.positional) {
      const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
      subCmd.argument(bracket, arg.help ?? '');
      positionalArgs.push(arg);
    } else {
      const flag = arg.required ? `--${arg.name} <value>` : `--${arg.name} [value]`;
      if (arg.required) subCmd.requiredOption(flag, arg.help ?? '');
      else if (arg.default != null) subCmd.option(flag, arg.help ?? '', String(arg.default));
      else subCmd.option(flag, arg.help ?? '');
    }
  }
  subCmd
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
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

      const verbose = optionsRecord.verbose === true;
      const format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
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

      if (verbose && (!result || (Array.isArray(result) && result.length === 0))) {
        console.error(chalk.yellow('[Verbose] Warning: Command returned an empty result.'));
      }
      const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
      renderOutput(result, {
        fmt: format,
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

// ── Exit code resolution ─────────────────────────────────────────────────────

/**
 * Map any thrown value to a Unix process exit code.
 *
 * - CliError subclasses carry their own exitCode (set in errors.ts).
 * - Generic Error objects are classified by message pattern so that
 *   un-typed auth / not-found errors from adapters still produce
 *   meaningful exit codes for shell scripts.
 */
function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;

  // Pattern-based fallback for untyped errors thrown by third-party adapters.
  const msg = getErrorMessage(err);
  const kind = classifyGenericError(msg);
  if (kind === 'auth')      return EXIT_CODES.NOPERM;
  if (kind === 'not-found') return EXIT_CODES.EMPTY_RESULT;
  if (kind === 'http')      return EXIT_CODES.GENERIC_ERROR;  // HTTP 4xx/5xx → generic; renderer shows details
  return EXIT_CODES.GENERIC_ERROR;
}

// ── Error rendering ──────────────────────────────────────────────────────────

const ISSUES_URL = 'https://github.com/jackwener/opencli/issues';

/** Pattern-based classifier for untyped errors thrown by adapters. */
function classifyGenericError(msg: string): 'auth' | 'http' | 'not-found' | 'other' {
  const m = msg.toLowerCase();
  if (/not logged in|login required|please log in|未登录|请先登录|authentication required|cookie expired/.test(m)) return 'auth';
  // Match "HTTP 404", "status: 500", "status 403", bare "404 Not Found", etc.
  if (/\b(status[: ]+)?[45]\d{2}\b|http[/ ][45]\d{2}/.test(m)) return 'http';
  if (/not found|未找到|could not find|no .+ found/.test(m)) return 'not-found';
  return 'other';
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
  } else {
    console.error(chalk.yellow('  Connection failed despite extension being active.'));
    console.error(chalk.dim('  Try reloading the extension, or run: opencli doctor'));
  }
}

async function renderError(err: unknown, cmdName: string, verbose: boolean): Promise<void> {
  // ── BrowserConnectError: real-time diagnosis, kind as fallback ────────
  if (err instanceof BrowserConnectError) {
    console.error(chalk.red('🔌 Browser Bridge not connected'));
    console.error();
    try {
      // 300ms matches execution.ts — localhost responds in <50ms when running.
      const status = await checkDaemonStatus({ timeout: 300 });
      renderBridgeStatus(status.running, status.extensionConnected);
    } catch (_statusErr) {
      // checkDaemonStatus itself failed — derive best-guess state from kind.
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
    console.error(chalk.yellow(`→ ${err.hint ?? `Open Chrome and log in to https://${err.domain}, then retry.`}`));
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
    console.error(chalk.yellow('→ The page structure may have changed — this adapter may be outdated.'));
    console.error(chalk.dim(`  Debug:  ${cmdName} --verbose`));
    console.error(chalk.dim(`  Report: ${ISSUES_URL}`));
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
  const kind = classifyGenericError(msg);

  if (kind === 'auth') {
    console.error(chalk.red(`🔒 ${msg}`));
    console.error(chalk.yellow('→ Open Chrome, log in to the target site, then retry.'));
    return;
  }
  if (kind === 'http') {
    console.error(chalk.red(`🌐 ${msg}`));
    console.error(chalk.yellow('→ Check your login status, or the site may be temporarily unavailable.'));
    return;
  }
  if (kind === 'not-found') {
    console.error(chalk.red(`📭 ${msg}`));
    console.error(chalk.yellow('→ The resource was not found. The adapter or page structure may have changed.'));
    console.error(chalk.dim(`  Report: ${ISSUES_URL}`));
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
  for (const [, cmd] of getRegistry()) {
    let siteCmd = siteGroups.get(cmd.site);
    if (!siteCmd) {
      siteCmd = program.command(cmd.site).description(`${cmd.site} commands`);
      siteGroups.set(cmd.site, siteCmd);
    }
    registerCommandToProgram(siteCmd, cmd);
  }
}
