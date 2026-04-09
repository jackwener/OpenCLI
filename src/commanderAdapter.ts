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
import yaml from 'js-yaml';
import { type CliCommand, fullName, getRegistry } from './registry.js';
import { formatRegistryHelpText } from './serialization.js';
import { render as renderOutput } from './output.js';
import { executeCommand } from './execution.js';
import {
  CliError,
  EXIT_CODES,
  ArgumentError,
  toEnvelope,
} from './errors.js';
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
      renderError(err, fullName(cmd), optionsRecord.verbose === true);
      process.exitCode = resolveExitCode(err);
    }
  });
}

// ── Exit code resolution ─────────────────────────────────────────────────────

function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) return err.exitCode;
  return EXIT_CODES.GENERIC_ERROR;
}

// ── Error rendering ─────────────────────────────────────────────────────────

/** Emit AutoFix hint for repairable adapter errors (skipped if already in diagnostic mode). */
function emitAutoFixHint(envelope: string, cmdName: string): string {
  if (isDiagnosticEnabled()) return envelope;
  return envelope + `# AutoFix: re-run with OPENCLI_DIAGNOSTIC=1 for repair context\n# OPENCLI_DIAGNOSTIC=1 ${cmdName}\n`;
}

function renderError(err: unknown, cmdName: string, verbose: boolean): void {
  const envelope = toEnvelope(err);

  // In verbose mode, include stack trace for debugging
  if (verbose && err instanceof Error && err.stack) {
    envelope.error.stack = err.stack;
  }

  let output = yaml.dump(envelope, { sortKeys: false, lineWidth: 120, noRefs: true });

  // Append AutoFix hint for repairable errors
  const code = envelope.error.code;
  if (code === 'SELECTOR' || code === 'EMPTY_RESULT' || code === 'ADAPTER_LOAD' || code === 'UNKNOWN') {
    output = emitAutoFixHint(output, cmdName);
  }

  process.stderr.write(output);
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
