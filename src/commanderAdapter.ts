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
import { log } from './logger.js';
import yaml from 'js-yaml';
import { type CliCommand, fullName, getRegistry } from './registry.js';
import { render as renderOutput } from './output.js';
import { executeCommand, prepareCommandArgs } from './execution.js';
import {
  commandHelpData,
  formatCommandHelpText,
  formatCommandListTerm,
  formatSiteCommandDescription,
  formatSiteHelpText,
  getRequestedHelpFormat,
  installStructuredHelp,
  renderStructuredHelp,
  siteHelpData,
} from './help.js';
import {
  CliError,
  EXIT_CODES,
  toEnvelope,
} from './errors.js';

/**
 * Register a single CliCommand as a Commander subcommand.
 */
export function registerCommandToProgram(siteCmd: Command, cmd: CliCommand): void {
  if (siteCmd.commands.some((c: Command) => c.name() === cmd.name)) return;

  const subCmd = siteCmd.command(cmd.name).description(formatSiteCommandDescription(cmd));
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
    .option('--trace <mode>', 'Trace capture: off, on, retain-on-failure', 'off')
    .option('-v, --verbose', 'Debug output', false);

  const originalHelpInformation = subCmd.helpInformation.bind(subCmd);
  subCmd.helpInformation = ((contextOptions?: unknown) => {
    const format = getRequestedHelpFormat();
    if (format) return renderStructuredHelp(commandHelpData(cmd), format);
    // Keep a fallback reference so future Commander upgrades still initialize
    // internal help state before we render the cleaner grouped command help.
    void originalHelpInformation(contextOptions as never);
    return formatCommandHelpText(cmd);
  }) as Command['helpInformation'];

  subCmd.action(async (...actionArgs: unknown[]) => {
    const actionOpts = actionArgs[positionalArgs.length] ?? {};
    const optionsRecord = typeof actionOpts === 'object' && actionOpts !== null ? actionOpts as Record<string, unknown> : {};
    const startTime = Date.now();

    // ── Execute + render ────────────────────────────────────────────────
    try {
      // ── Collect kwargs ────────────────────────────────────────────────
      const rawKwargs: Record<string, unknown> = {};
      for (let i = 0; i < positionalArgs.length; i++) {
        const v = actionArgs[i];
        if (v !== undefined) rawKwargs[positionalArgs[i].name] = v;
      }
      for (const arg of cmd.args) {
        if (arg.positional) continue;
        const camelName = arg.name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
        const v = optionsRecord[arg.name] ?? optionsRecord[camelName];
        if (v !== undefined) rawKwargs[arg.name] = v;
      }
      const optionSources: Record<string, string> = {};
      for (const arg of cmd.args) {
        if (arg.positional) continue;
        const camelName = arg.name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
        const source = subCmd.getOptionValueSource(camelName) ?? subCmd.getOptionValueSource(arg.name);
        if (source === 'cli') optionSources[arg.name] = source;
      }
      if (Object.keys(optionSources).length > 0) {
        rawKwargs.__opencliOptionSources = optionSources;
      }
      const kwargs = prepareCommandArgs(cmd, rawKwargs);

      const verbose = optionsRecord.verbose === true;
      let format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
      const formatExplicit = subCmd.getOptionValueSource('format') === 'cli';
      if (verbose) process.env.OPENCLI_VERBOSE = '1';
      const globals = typeof subCmd.optsWithGlobals === 'function' ? subCmd.optsWithGlobals() as Record<string, unknown> : {};
      const result = await executeCommand(cmd, kwargs, verbose, {
        prepared: true,
        ...(typeof globals.profile === 'string' && globals.profile.trim() ? { profile: globals.profile.trim() } : {}),
        ...(typeof optionsRecord.trace === 'string' && optionsRecord.trace !== 'off' ? { trace: optionsRecord.trace } : {}),
      });
      if (result === null || result === undefined) {
        return;
      }

      const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
      if (!formatExplicit && format === 'table' && resolved.defaultFormat) {
        format = resolved.defaultFormat;
      }

      if (verbose && (!result || (Array.isArray(result) && result.length === 0))) {
        log.warn('Command returned an empty result.');
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
      renderError(err, fullName(cmd), optionsRecord.verbose === true, optionsRecord.trace);
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

/** Emit AutoFix hint for repairable adapter errors (skipped if trace already exported). */
function emitAutoFixHint(envelope: string, cmdName: string, traceMode: unknown): string {
  if (traceMode === 'on' || traceMode === 'retain-on-failure') return envelope;
  const runnable = cmdName.replace('/', ' ');
  return envelope
    + `# AutoFix: re-run with --trace=retain-on-failure for trace artifact\n`
    + `# opencli ${runnable} --trace retain-on-failure\n`;
}

function renderError(err: unknown, cmdName: string, verbose: boolean, traceMode?: unknown): void {
  const envelope = toEnvelope(err);

  // In verbose mode, include stack trace for debugging
  if (verbose && err instanceof Error && err.stack) {
    envelope.error.stack = err.stack;
  }

  let output = yaml.dump(envelope, { sortKeys: false, lineWidth: 120, noRefs: true });

  // Append AutoFix hint for repairable errors
  const code = envelope.error.code;
  if (code === 'SELECTOR' || code === 'EMPTY_RESULT' || code === 'ADAPTER_LOAD' || code === 'UNKNOWN') {
    output = emitAutoFixHint(output, cmdName, traceMode);
  }

  process.stderr.write(output);
}

/**
 * Register all commands from the registry onto a Commander program.
 */
export function registerAllCommands(
  program: Command,
  siteGroups: Map<string, Command>,
): string[] {
  const seen = new Set<CliCommand>();
  const commandsBySite = new Map<string, CliCommand[]>();
  for (const [, cmd] of getRegistry()) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    const commands = commandsBySite.get(cmd.site) ?? [];
    commands.push(cmd);
    commandsBySite.set(cmd.site, commands);
  }

  for (const [site, commands] of commandsBySite) {
    let siteCmd = siteGroups.get(site);
    if (!siteCmd) {
      siteCmd = program.command(site);
      siteGroups.set(site, siteCmd);
    }
    for (const cmd of commands) {
      registerCommandToProgram(siteCmd, cmd);
    }
    const commandTerms = new Map(commands.map(cmd => [cmd.name, formatCommandListTerm(cmd)]));
    siteCmd.configureHelp({
      subcommandTerm: command => commandTerms.get(command.name()) ?? command.name(),
    });
    const originalSiteHelpInformation = siteCmd.helpInformation.bind(siteCmd);
    siteCmd.helpInformation = ((contextOptions?: unknown) => {
      const format = getRequestedHelpFormat();
      if (format) return renderStructuredHelp(siteHelpData(site, commands), format);
      void originalSiteHelpInformation(contextOptions as never);
      return formatSiteHelpText(site, commands);
    }) as Command['helpInformation'];
  }
  return [...commandsBySite.keys()].sort((a, b) => a.localeCompare(b));
}
