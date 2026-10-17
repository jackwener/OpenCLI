/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in namespaces are registered by commands/*.ts.
 * Dynamic adapter commands are registered via commanderAdapter.ts.
 */

import { Command, Option } from 'commander';
import { fileURLToPath } from 'node:url';
import { emitFailure, emitResult } from './command-output.js';
import { registerAllCommands } from './commanderAdapter.js';
import { registerAdapterCommands } from './commands/adapter.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerBrowserCommands } from './commands/browser.js';
import { daemonRestart, daemonStatus, daemonStop } from './commands/daemon.js';
import { registerListCommand } from './commands/list.js';
import { registerPluginCommands } from './commands/plugin.js';
import { registerProfileCommands } from './commands/profile.js';
import { printCompletionScript } from './completion.js';
import { CliError, EXIT_CODES } from './errors.js';
import { formatRootAdapterHelpText, installCommanderNamespaceStructuredHelp, installStructuredHelp, rootHelpData, type RootAdapterGroups } from './help.js';
import { normalizeOutputFormat } from './output-format.js';
import { render as renderOutput } from './output.js';
import { findPackageRoot } from './package-paths.js';
import { listOpenCliSkills, readOpenCliSkill } from './skills.js';
import { PKG_VERSION } from './version.js';

const CLI_FILE = fileURLToPath(import.meta.url);

function applyVerbose(opts: { verbose?: boolean }): void {
  if (opts.verbose) process.env.OPENCLI_VERBOSE = '1';
}

function formatChildCommandSummary(command: Command): string {
  return [...new Set(command.commands.map(child => child.name()))]
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

function applyRootSubcommandSummaries(program: Command): void {
  for (const command of program.commands) {
    if (command.commands.length === 0) continue;
    const summary = formatChildCommandSummary(command);
    if (summary) command.description(summary);
  }
}

export function createProgram(BUILTIN_CLIS: string, USER_CLIS: string): Command {
  const program = new Command();
  // Prevent the parent from consuming flags meant for subcommands.
  program
    .name('opencli')
    .description('Make any website your CLI. Zero setup. AI-powered.')
    .version(PKG_VERSION)
    .option('--profile <name>', 'Chrome profile/context alias for Browser Bridge commands')
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({ writeErr: () => {} });

  registerListCommand(program);

  const skillsCmd = program
    .command('skills')
    .description('Read bundled OpenCLI skills');

  skillsCmd
    .command('list')
    .description('List bundled opencli-* skills')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', normalizeOutputFormat, 'json')
    .action((opts) => {
      const rows = listOpenCliSkills();
      renderOutput(rows, {
        fmt: opts.format,
        fmtExplicit: !!opts.format,
        columns: ['name', 'description', 'version', 'path'],
        title: 'opencli/skills/list',
        source: 'opencli skills list',
      });
    });

  skillsCmd
    .command('read')
    .description("Print an opencli-* skill's SKILL.md or reference file")
    .argument('<skill>', 'Skill name, or skill/path like opencli-browser/references/foo.md')
    .argument('[path]', 'Path under the skill directory')
    .addOption(new Option('-f, --format <fmt>', 'json or plain').choices(['json', 'plain']).default('json'))
    .action((skill: string, skillPath: string | undefined, opts) => {
      let result: ReturnType<typeof readOpenCliSkill>;
      try {
        result = readOpenCliSkill(skill, skillPath ?? '');
      } catch (err) {
        emitFailure(err, err instanceof CliError ? err.exitCode : EXIT_CODES.GENERIC_ERROR);
        return;
      }
      if (opts.format === 'plain') process.stdout.write(result.content);
      else emitResult(result);
    });

  const authCmd = registerAuthCommands(program);

  program
    .command('convention-audit')
    .description('Scan adapters for agent-native convention violations')
    .argument('[target]', 'site or site/name')
    .option('--site <site>', 'Limit audit to one site')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', normalizeOutputFormat, 'json')
    .option('--strict', 'Exit non-zero when violations are found', false)
    .action(async (target, opts) => {
      const { runConventionAudit, renderConventionAuditText } = await import('./convention-audit.js');
      const report = runConventionAudit({
        projectRoot: findPackageRoot(CLI_FILE),
        target,
        site: opts.site,
      });
      if (opts.strict && !report.ok) { emitFailure({ code: 'convention_violations', message: 'Adapter convention violations found.', details: report }); return; }
      const fmt = String(opts.format ?? 'json').toLowerCase();
      if (fmt === 'json' || fmt === 'yaml' || fmt === 'yml') {
        renderOutput(report, { fmt });
      } else {
        console.log(renderConventionAuditText(report));
      }
    });

  // ── Built-in: browser (browser control for Claude Code skill) ───────────────
  //
  // Make websites accessible for AI agents.
  // All commands wrapped in browserAction() for consistent error handling.

  const browser = registerBrowserCommands(program);

  // ── Built-in: doctor / completion ──────────────────────────────────────────

  program
    .command('doctor')
    .description('Diagnose opencli browser bridge connectivity')
    .option('-v, --verbose', 'Debug output')
    .action(async (opts) => {
      applyVerbose(opts);
      const { runBrowserDoctor } = await import('./doctor.js');
      const report = await runBrowserDoctor({ cliVersion: PKG_VERSION });
      emitResult(report);
    });

  program
    .command('completion')
    .description('Output shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell) => {
      printCompletionScript(shell);
    });

  // ── Plugin management ──────────────────────────────────────────────────────

  const pluginCmd = registerPluginCommands(program);

  const adapterCmd = registerAdapterCommands(program, BUILTIN_CLIS, USER_CLIS);

  const profileCmd = registerProfileCommands(program);

  const daemonCmd = program.command('daemon').description('Manage the opencli daemon');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalDaemonDescription = daemonCmd.description();
  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => { await daemonStatus(); });
  daemonCmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => { await daemonStop(); });
  daemonCmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => { await daemonRestart(); });

  // ── Dynamic adapter commands ──────────────────────────────────────────────

  const siteNames = registerAllCommands(program);
  applyRootSubcommandSummaries(program);

  const adapterGroups: RootAdapterGroups = { sites: [...siteNames] };
  const adapterNameSet = new Set<string>(siteNames);
  installCommanderNamespaceStructuredHelp(authCmd, { globalCommand: program, description: 'Inspect website login status' });
  installCommanderNamespaceStructuredHelp(daemonCmd, { globalCommand: program, description: originalDaemonDescription });
  program.configureHelp({
    visibleCommands: (command) => command.commands.filter(child => command !== program || !adapterNameSet.has(child.name())),
  });
  installStructuredHelp(program, () => rootHelpData(program, adapterGroups), () => formatRootAdapterHelpText(adapterGroups));

  // ── Unknown command fallback ──────────────────────────────────────────────
  program.on('command:*', (operands: string[]) => {
    const binary = operands[0];
    emitFailure({ code: 'unknown_command', message: `Unknown command: ${binary}`, hint: 'Use opencli list <query> to find a capability.' }, EXIT_CODES.USAGE_ERROR);
  });

  return program;
}

export async function runCli(BUILTIN_CLIS: string, USER_CLIS: string): Promise<void> {
  try { await createProgram(BUILTIN_CLIS, USER_CLIS).parseAsync(); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version') return;
    emitFailure(error);
  }
}

export { findPackageRoot, normalizeVerifyRows, resolveBrowserVerifyInvocation } from './commands/adapter.js';
export { selectFreshByTimestamp } from './commands/browser.js';
