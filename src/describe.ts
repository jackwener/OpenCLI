/**
 * `opencli describe` — unified CLI capability discovery for AI agents.
 *
 * Two data sources, one entry point:
 * - Built-in commands: reads structured data from CliCommand registry
 * - External CLIs: collects help text via `binary --help`, extracts subcommand names + summaries
 */

import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { getRegistry, strategyLabel, type Arg, type CliCommand } from './registry.js';
import { loadExternalClis, isBinaryInstalled, getInstallCmd, type ExternalCliConfig } from './external.js';
import { CliError } from './errors.js';

export interface SubcommandEntry {
  name: string;
  summary: string;
}

export interface DescribeResult {
  name: string;
  type: 'builtin' | 'external';
  description: string;
  commands?: { name: string; description: string; strategy: string }[];
  args?: Arg[];
  columns?: string[];
  strategy?: string;
  browser?: boolean;
  domain?: string;
  installed?: boolean;
  install?: string;
  subcommands?: SubcommandEntry[];
  help?: string;
}

/** Run `binary [...args] --help` and capture the output. Returns null on failure or timeout. */
export function getCliHelp(binary: string, args: string[] = []): string | null {
  try {
    const result = spawnSync(binary, [...args, '--help'], {
      timeout: 5000,
      encoding: 'utf8',
      env: {
        ...process.env,
        PAGER: 'cat',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Prefer stdout; fall back to stderr (some CLIs write help to stderr)
    const stdout = result.stdout?.trim() ?? '';
    const stderr = result.stderr?.trim() ?? '';
    const output = stdout.length > 0 ? stdout : stderr;

    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Extract subcommand names and summaries from help text.
 * Handles multiple command groups (e.g. gh's CORE COMMANDS / ADDITIONAL COMMANDS).
 */
export function parseSubcommands(helpText: string): SubcommandEntry[] {
  const results: SubcommandEntry[] = [];
  const lines = helpText.split('\n');
  const seen = new Set<string>();

  const headerPattern = /^[A-Z\s]*\b(?:commands?|subcommands?)\b/i;
  const commandLinePattern = /^\s{2,}(\S+)\s{2,}(.+)/;

  let inCommandSection = false;

  for (const line of lines) {
    if (headerPattern.test(line.trim())) {
      inCommandSection = true;
      continue;
    }

    if (inCommandSection) {
      if (line.trim() === '') continue;

      const match = commandLinePattern.exec(line);
      if (match) {
        // Strip trailing colon from Cobra-style command names (e.g. "browse:" → "browse")
        const name = match[1].replace(/:$/, '');
        const summary = match[2].trim();
        if (name === 'help' || name === 'completion') continue;
        if (!seen.has(name)) {
          seen.add(name);
          results.push({ name, summary });
        }
      } else if (/^\S/.test(line)) {
        // Non-indented, non-empty line — end of current section, keep scanning for more
        inCommandSection = false;
      }
    }
  }

  return results;
}

/**
 * Describe a target (built-in site or external CLI).
 * Must be called after discoverClis() has populated the registry.
 */
export function describeTarget(target: string, subcommands: string[] = []): DescribeResult {
  const registry = getRegistry();

  const siteCommands: CliCommand[] = [];
  for (const [, cmd] of registry) {
    if (cmd.site === target) siteCommands.push(cmd);
  }

  if (siteCommands.length > 0) {
    return describeBuiltin(target, siteCommands, subcommands);
  }

  const externalClis = loadExternalClis();
  const ext = externalClis.find((c) => c.name === target);
  if (ext) {
    return describeExternal(ext, subcommands);
  }

  throw new CliError('NOT_FOUND', `Unknown command: '${target}'.`, "Run 'opencli list' to see available commands.");
}

function describeBuiltin(site: string, commands: CliCommand[], subcommands: string[]): DescribeResult {
  if (subcommands.length > 0) {
    const cmdName = subcommands.join(' ');
    const cmd = commands.find((c) => c.name === cmdName);
    if (!cmd) {
      throw new CliError('NOT_FOUND', `Unknown command: '${site} ${cmdName}'.`, `Run 'opencli describe ${site}' to see available commands.`);
    }
    return {
      name: `${site}/${cmd.name}`,
      type: 'builtin',
      description: cmd.description,
      args: cmd.args,
      columns: cmd.columns,
      strategy: strategyLabel(cmd),
      browser: cmd.browser,
      domain: cmd.domain,
    };
  }

  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  return {
    name: site,
    type: 'builtin',
    description: `${sorted.length} commands`,
    commands: sorted.map((c) => ({
      name: c.name,
      description: c.description,
      strategy: strategyLabel(c),
    })),
  };
}

function describeExternal(ext: ExternalCliConfig, subcommands: string[]): DescribeResult {
  const installed = isBinaryInstalled(ext.binary);

  if (!installed) {
    return {
      name: ext.name,
      type: 'external',
      description: ext.description ?? ext.name,
      installed: false,
      install: getInstallCmd(ext.install) ?? undefined,
    };
  }

  const help = getCliHelp(ext.binary, subcommands);
  const subcmds = help ? parseSubcommands(help) : [];

  return {
    name: subcommands.length > 0 ? `${ext.name} ${subcommands.join(' ')}` : ext.name,
    type: 'external',
    description: ext.description ?? ext.name,
    installed: true,
    subcommands: subcmds,
    help: help ?? undefined,
  };
}

/** Render a describe result as text for human consumption. */
export function renderDescribeText(result: DescribeResult): string {
  const lines: string[] = [''];

  if (result.type === 'builtin') {
    if (result.commands) {
      lines.push(chalk.bold(`  ${result.name}`) + chalk.dim(` — ${result.description}`));
      lines.push('');
      for (const cmd of result.commands) {
        const tag = cmd.strategy === 'public' ? chalk.green(`[${cmd.strategy}]`) : chalk.yellow(`[${cmd.strategy}]`);
        lines.push(`    ${cmd.name.padEnd(20)} ${tag}  ${chalk.dim(cmd.description)}`);
      }
    } else {
      lines.push(chalk.bold(`  ${result.name}`) + chalk.dim(` — ${result.description}`));
      lines.push(`  Strategy: ${result.strategy} | Browser: ${result.browser ? 'yes' : 'no'}${result.domain ? ` | Domain: ${result.domain}` : ''}`);

      if (result.args && result.args.length > 0) {
        lines.push('');
        lines.push('  Arguments:');
        for (const arg of result.args) {
          const prefix = arg.positional ? `<${arg.name}>` : `--${arg.name} ${arg.required ? '<value>' : '[value]'}`;
          const reqTag = arg.required ? chalk.red('(required)') : '';
          const defTag = arg.default != null ? chalk.dim(`(default: ${arg.default})`) : '';
          const choicesTag = arg.choices?.length ? chalk.cyan(`Choices: ${arg.choices.join(', ')}`) : '';
          const helpText = arg.help ? chalk.dim(arg.help) : '';
          const parts = [prefix, reqTag, defTag, choicesTag, helpText].filter(Boolean);
          lines.push(`    ${parts.join('  ')}`);
        }
      }

      if (result.columns && result.columns.length > 0) {
        lines.push('');
        lines.push(`  Output columns: ${result.columns.join(', ')}`);
      }
    }
  } else {
    const statusTag = result.installed ? chalk.green('[installed]') : chalk.yellow('[not installed]');
    lines.push(chalk.bold(`  ${result.name}`) + ` (external) — ${result.description} ${statusTag}`);

    if (!result.installed) {
      if (result.install) {
        lines.push('');
        lines.push(`  Install: ${chalk.cyan(result.install)}`);
      }
    } else {
      if (result.subcommands && result.subcommands.length > 0) {
        lines.push('');
        lines.push('  Subcommands:');
        for (const sub of result.subcommands) {
          lines.push(`    ${sub.name.padEnd(16)} ${chalk.dim(sub.summary)}`);
        }
        lines.push('');
        lines.push(chalk.dim(`  Run 'opencli describe ${result.name} <subcommand>' for details.`));
      }

      if (result.help && (!result.subcommands || result.subcommands.length === 0)) {
        // No subcommands extracted — show raw help (truncated to 50 lines)
        lines.push('');
        lines.push(chalk.dim('  Help output:'));
        const helpLines = result.help.split('\n');
        const maxLines = 50;
        for (const helpLine of helpLines.slice(0, maxLines)) {
          lines.push(`  ${helpLine}`);
        }
        if (helpLines.length > maxLines) {
          lines.push(chalk.dim(`  ... (${helpLines.length - maxLines} more lines, run '${result.name} --help' for full output)`));
        }
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Render a describe result as JSON. */
export function renderDescribeJson(result: DescribeResult): string {
  const clean = JSON.parse(JSON.stringify(result));
  return JSON.stringify(clean, null, 2);
}
