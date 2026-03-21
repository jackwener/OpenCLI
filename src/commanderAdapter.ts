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
import { CliError } from './errors.js';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Register a single CliCommand as a Commander subcommand.
 */
export function registerCommandToProgram(siteCmd: Command, cmd: CliCommand): void {
  if (siteCmd.commands.some((c: Command) => c.name() === cmd.name)) return;

  const subCmd = siteCmd.command(cmd.name).description(cmd.description);

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

    // ── Collect kwargs ──────────────────────────────────────────────────
    const kwargs: Record<string, unknown> = {};
    for (let i = 0; i < positionalArgs.length; i++) {
      const v = actionArgs[i];
      if (v !== undefined) kwargs[positionalArgs[i].name] = v;
    }
    for (const arg of cmd.args) {
      if (arg.positional) continue;
      const camelName = arg.name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
      const v = optionsRecord[arg.name] ?? optionsRecord[camelName];
      if (v !== undefined) kwargs[arg.name] = v;
    }

    // ── Execute + render ────────────────────────────────────────────────
    try {
      const verbose = optionsRecord.verbose === true;
      const format = typeof optionsRecord.format === 'string' ? optionsRecord.format : 'table';
      if (verbose) process.env.OPENCLI_VERBOSE = '1';

      const result = await executeCommand(cmd, kwargs, verbose);

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
      if (err instanceof CliError) {
        console.error(chalk.red(`Error [${err.code}]: ${err.message}`));
        if (err.hint) console.error(chalk.yellow(`Hint: ${err.hint}`));
      } else if (optionsRecord.verbose === true && err instanceof Error && err.stack) {
        console.error(chalk.red(err.stack));
      } else {
        console.error(chalk.red(`Error: ${getErrorMessage(err)}`));
      }
      process.exitCode = 1;
    }
  });
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
