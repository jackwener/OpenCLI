/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in commands are registered inline here (list, validate, explore, etc.).
 * Dynamic adapter commands are registered via commanderAdapter.ts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { serializeCommand, formatArgSummary } from './serialization.js';
import { render as renderOutput } from './output.js';
import { getBrowserFactory, browserSession } from './runtime.js';
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { loadExternalClis, executeExternalCli, installExternalCli, registerExternalCli, isBinaryInstalled } from './external.js';
import { registerAllCommands } from './commanderAdapter.js';
import { CliError } from './errors.js';
import { applyBrowserRuntimeOptions } from './browser/backend.js';
import { runBrowserBackendDoctor, renderBrowserBackendDoctorReport } from './browser/doctor.js';
import { launchDebugBrowser } from './browser/launch.js';
import { listDebugBrowsers, parsePortList, parsePortRange } from './browser/instances.js';
import { renderStopBrowsersReport, stopBrowsers } from './browser/manage.js';
import {
  listBrowserProfiles,
  profileLabel,
  pruneTemporaryProfiles,
  removeBrowserProfile,
  renderPruneTemporaryProfilesReport,
  renderRemoveBrowserProfileReport,
} from './browser/profiles.js';
import { extractPassthroughArgs, runOpenCliWithBrowserBackend } from './browser/run.js';

function addBrowserRuntimeOptions(command: Command): Command {
  return command
    .option('--backend <mode>', 'Browser backend: auto, extension, cdp', 'auto')
    .option('--cdp-endpoint <url>', 'Direct CDP endpoint, for example http://127.0.0.1:9222')
    .option('--cdp-target <pattern>', 'Preferred CDP target title or URL pattern');
}

function applyBrowserOptions(opts: { backend?: string; cdpEndpoint?: string; cdpTarget?: string } = {}): void {
  applyBrowserRuntimeOptions({
    mode: opts.backend,
    cdpEndpoint: opts.cdpEndpoint,
    cdpTarget: opts.cdpTarget,
  });
}

function collectRepeatedOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  const program = new Command();
  program
    .name('opencli')
    .description('Make any website your CLI. Zero setup. AI-powered.')
    .version(PKG_VERSION);

  // ── Built-in: list ────────────────────────────────────────────────────────

  program
    .command('list')
    .description('List all available CLI commands')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .option('--json', 'JSON output (deprecated)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...registry.values()].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const fmt = opts.json && opts.format === 'table' ? 'json' : opts.format;
      const isStructured = fmt === 'json' || fmt === 'yaml';

      if (fmt !== 'table') {
        const rows = isStructured
          ? commands.map(serializeCommand)
          : commands.map(c => ({
              command: fullName(c),
              site: c.site,
              name: c.name,
              description: c.description,
              strategy: strategyLabel(c),
              browser: !!c.browser,
              args: formatArgSummary(c.args),
            }));
        renderOutput(rows, {
          fmt,
          columns: ['command', 'site', 'name', 'description', 'strategy', 'browser', 'args',
                     ...(isStructured ? ['columns', 'domain'] : [])],
          title: 'opencli/list',
          source: 'opencli list',
        });
        return;
      }

      // Table (default) — grouped by site
      const sites = new Map<string, CliCommand[]>();
      for (const cmd of commands) {
        const g = sites.get(cmd.site) ?? [];
        g.push(cmd);
        sites.set(cmd.site, g);
      }

      console.log();
      console.log(chalk.bold('  opencli') + chalk.dim(' — available commands'));
      console.log();
      for (const [site, cmds] of sites) {
        console.log(chalk.bold.cyan(`  ${site}`));
        for (const cmd of cmds) {
          const tag = strategyLabel(cmd) === 'public'
            ? chalk.green('[public]')
            : chalk.yellow(`[${strategyLabel(cmd)}]`);
          console.log(`    ${cmd.name} ${tag}${cmd.description ? chalk.dim(` — ${cmd.description}`) : ''}`);
        }
        console.log();
      }

      const externalClis = loadExternalClis();
      if (externalClis.length > 0) {
        console.log(chalk.bold.cyan('  external CLIs'));
        for (const ext of externalClis) {
          const isInstalled = isBinaryInstalled(ext.binary);
          const tag = isInstalled ? chalk.green('[installed]') : chalk.yellow('[auto-install]');
          console.log(`    ${ext.name} ${tag}${ext.description ? chalk.dim(` — ${ext.description}`) : ''}`);
        }
        console.log();
      }

      console.log(chalk.dim(`  ${commands.length} built-in commands across ${sites.size} sites, ${externalClis.length} external CLIs`));
      console.log();
    });

  // ── Built-in: validate / verify ───────────────────────────────────────────

  program
    .command('validate')
    .description('Validate CLI definitions')
    .argument('[target]', 'site or site/name')
    .action(async (target) => {
      const { validateClisWithTarget, renderValidationReport } = await import('./validate.js');
      console.log(renderValidationReport(validateClisWithTarget([BUILTIN_CLIS, USER_CLIS], target)));
    });

  program
    .command('verify')
    .description('Validate + smoke test')
    .argument('[target]')
    .option('--smoke', 'Run smoke tests', false)
    .action(async (target, opts) => {
      const { verifyClis, renderVerifyReport } = await import('./verify.js');
      const r = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target, smoke: opts.smoke });
      console.log(renderVerifyReport(r));
      process.exitCode = r.ok ? 0 : 1;
    });

  // ── Built-in: explore / synthesize / generate / cascade ───────────────────

  program
    .command('explore')
    .alias('probe')
    .description('Explore a website: discover APIs, stores, and recommend strategies')
    .argument('<url>')
    .option('--site <name>')
    .option('--goal <text>')
    .option('--wait <s>', '', '3')
    .option('--auto', 'Enable interactive fuzzing')
    .option('--click <labels>', 'Comma-separated labels to click before fuzzing')
    .action(async (url, opts) => {
      const { exploreUrl, renderExploreSummary } = await import('./explore.js');
      const clickLabels = opts.click
        ? opts.click.split(',').map((s: string) => s.trim())
        : undefined;
      const workspace = `explore:${inferHost(url, opts.site)}`;
      const result = await exploreUrl(url, {
        BrowserFactory: getBrowserFactory() as any,
        site: opts.site,
        goal: opts.goal,
        waitSeconds: parseFloat(opts.wait),
        auto: opts.auto,
        clickLabels,
        workspace,
      });
      console.log(renderExploreSummary(result));
    });

  program
    .command('synthesize')
    .description('Synthesize CLIs from explore')
    .argument('<target>')
    .option('--top <n>', '', '3')
    .action(async (target, opts) => {
      const { synthesizeFromExplore, renderSynthesizeSummary } = await import('./synthesize.js');
      console.log(renderSynthesizeSummary(synthesizeFromExplore(target, { top: parseInt(opts.top) })));
    });

  program
    .command('generate')
    .description('One-shot: explore → synthesize → register')
    .argument('<url>')
    .option('--goal <text>')
    .option('--site <name>')
    .action(async (url, opts) => {
      const { generateCliFromUrl, renderGenerateSummary } = await import('./generate.js');
      const workspace = `generate:${inferHost(url, opts.site)}`;
      const r = await generateCliFromUrl({
        url,
        BrowserFactory: getBrowserFactory() as any,
        builtinClis: BUILTIN_CLIS,
        userClis: USER_CLIS,
        goal: opts.goal,
        site: opts.site,
        workspace,
      });
      console.log(renderGenerateSummary(r));
      process.exitCode = r.ok ? 0 : 1;
    });

  program
    .command('cascade')
    .description('Strategy cascade: find simplest working strategy')
    .argument('<url>')
    .option('--site <name>')
    .action(async (url, opts) => {
      const { cascadeProbe, renderCascadeResult } = await import('./cascade.js');
      const workspace = `cascade:${inferHost(url, opts.site)}`;
      const result = await browserSession(getBrowserFactory(), async (page) => {
        try {
          const siteUrl = new URL(url);
          await page.goto(`${siteUrl.protocol}//${siteUrl.host}`);
          await page.wait(2);
        } catch {}
        return cascadeProbe(page, url);
      }, { workspace });
      console.log(renderCascadeResult(result));
    });

  // ── Built-in: doctor / setup / completion ─────────────────────────────────

  program
    .command('doctor')
    .description('Diagnose opencli browser bridge connectivity')
    .option('--live', 'Test browser connectivity (requires Chrome running)', false)
    .option('--sessions', 'Show active automation sessions', false)
    .action(async (opts) => {
      const { runBrowserDoctor, renderBrowserDoctorReport } = await import('./doctor.js');
      const report = await runBrowserDoctor({ live: opts.live, sessions: opts.sessions, cliVersion: PKG_VERSION });
      console.log(renderBrowserDoctorReport(report));
    });

  program
    .command('setup')
    .description('Interactive setup: verify browser bridge connectivity')
    .action(async () => {
      const { runSetup } = await import('./setup.js');
      await runSetup({ cliVersion: PKG_VERSION });
    });

  program
    .command('completion')
    .description('Output shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell) => {
      printCompletionScript(shell);
    });

  const browserCmd = program
    .command('browser')
    .description('Additive browser backend utilities without modifying existing commands');
  browserCmd.helpCommand(false);

  addBrowserRuntimeOptions(
    browserCmd
      .command('doctor')
      .description('Diagnose browser backend connectivity for extension or CDP workflows')
      .option('--live', 'Test browser connectivity (requires backend to be reachable)', false)
      .option('--sessions', 'Show active automation sessions in extension mode', false),
  )
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser doctor --backend extension --live',
      '  opencli browser doctor --backend cdp --cdp-endpoint http://127.0.0.1:9222 --live',
    ].join('\n'))
    .action(async (opts) => {
      applyBrowserOptions(opts);
      const report = await runBrowserBackendDoctor({
        backend: opts.backend,
        live: opts.live,
        sessions: opts.sessions,
        cliVersion: PKG_VERSION,
      });
      console.log(renderBrowserBackendDoctorReport(report));
    });

  browserCmd
    .command('list')
    .description('List locally discoverable Chrome CDP browsers and opencli-launched instances')
    .option('--ports <list>', 'Additional ports to check, for example 9222,9339')
    .option('--range <start-end>', 'Port range to scan (default: 9222-9350)', '9222-9350')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser list',
      '  opencli browser list --ports 9222,9339',
      '  opencli browser list --range 9222-9400 --format json',
    ].join('\n'))
    .action(async (opts) => {
      const instances = await listDebugBrowsers({
        ports: parsePortList(opts.ports),
        range: parsePortRange(opts.range),
      });

      renderOutput(instances.map((entry) => ({
        port: entry.port,
        endpoint: entry.endpoint,
        browser: entry.browserName ?? '',
        pid: entry.pid ?? '',
        mode: entry.launchMode,
        profile: profileLabel(entry),
        kind: entry.userDataKind,
        source: entry.source,
        status: entry.status,
      })), {
        fmt: opts.format,
        columns: ['port', 'endpoint', 'browser', 'pid', 'mode', 'profile', 'kind', 'source', 'status'],
        title: 'opencli/browser/list',
        source: 'opencli browser list',
      });
    });

  browserCmd
    .command('launch')
    .description('Launch a Chrome/Chromium instance with a CDP debugging port')
    .option('--browser <path>', 'Browser executable name or absolute path')
    .option('--browser-arg <arg>', 'Additional raw browser launch argument; repeatable', collectRepeatedOption, [])
    .option('--port <port>', 'Remote debugging port', '9222')
    .option('--url <url>', 'Initial URL to open', 'about:blank')
    .option('--profile <name>', 'Named persistent browser profile to reuse')
    .option('--headless', 'Launch browser in headless mode', false)
    .option('--foreground', 'Keep the command attached until the browser is closed', false)
    .option('--timeout <ms>', 'Milliseconds to wait for the CDP endpoint', '15000')
    .addHelpText('after', [
      '',
      'Notes:',
      '  By default, launch uses a temporary browser profile.',
      '  Pass --profile <name> when you want to preserve login state or browser data.',
      '  Use --browser-arg to pass extra raw Chrome/Chromium flags.',
      '',
      'Examples:',
      '  opencli browser launch --port 9222',
      '  opencli browser launch --port 9222 --foreground',
      '  opencli browser launch --port 9222 --profile zhihu',
      '  opencli browser launch --port 9222 --browser-arg=--window-size=1440,900',
    ].join('\n'))
    .action(async (opts) => {
      const launched = await launchDebugBrowser({
        browser: opts.browser,
        browserArgs: opts.browserArg,
        port: parseInt(opts.port, 10),
        url: opts.url,
        profile: opts.profile,
        headless: opts.headless,
        foreground: opts.foreground,
        timeoutMs: parseInt(opts.timeout, 10),
      });

      console.log(chalk.green(`Launched debug browser (pid ${launched.pid})`));
      console.log(`  Backend: cdp`);
      console.log(`  Mode: ${launched.launchMode}`);
      console.log(`  Executable: ${launched.executable}`);
      console.log(`  Endpoint: ${launched.endpoint}`);
      console.log(`  Profile: ${launched.profileName ?? '(temporary)'}`);
      console.log(`  Kind: ${launched.userDataKind}`);
      if (opts.browserArg?.length) console.log(`  Extra args: ${opts.browserArg.join(' ')}`);
      if (launched.browserName) console.log(`  Browser: ${launched.browserName}`);
      if (launched.webSocketDebuggerUrl) console.log(`  WebSocket: ${launched.webSocketDebuggerUrl}`);
      console.log();
      console.log('Use it with:');
      console.log(`  opencli browser doctor --backend cdp --cdp-endpoint ${launched.endpoint} --live`);
      console.log(`  opencli browser run --backend cdp --cdp-endpoint ${launched.endpoint} -- zhihu search --keyword AI`);
      if (launched.userDataKind === 'temporary') {
        console.log('  opencli browser profiles prune --temporary');
      }
      if (launched.launchMode === 'foreground' && launched.exitPromise) {
        const exited = await launched.exitPromise;
        process.exitCode = exited.code ?? 0;
      }
    });

  browserCmd
    .command('stop')
    .description('Stop one or more opencli-launched debug browsers')
    .option('--port <port>', 'Stop the opencli-launched browser bound to this CDP port')
    .option('--pid <pid>', 'Stop a specific browser process id')
    .option('--all', 'Stop all running opencli-launched debug browsers', false)
    .option('--timeout <ms>', 'Milliseconds to wait for each process to exit', '5000')
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser stop --port 9339',
      '  opencli browser stop --pid 12345',
      '  opencli browser stop --all',
      '',
      'Notes:',
      '  This only stops browser processes.',
      '  Use `opencli browser profiles rm <name>` or `opencli browser profiles prune --temporary` for profile cleanup.',
    ].join('\n'))
    .action(async (opts) => {
      const report = await stopBrowsers({
        port: opts.port !== undefined ? parseInt(opts.port, 10) : undefined,
        pid: opts.pid !== undefined ? parseInt(opts.pid, 10) : undefined,
        all: opts.all,
        timeoutMs: parseInt(opts.timeout, 10),
      });
      console.log(renderStopBrowsersReport(report));
      process.exitCode = report.issues.length > 0 && report.stopped.length === 0 ? 1 : 0;
    });

  const profilesCmd = browserCmd
    .command('profiles')
    .description('List and manage persistent and temporary browser profiles');
  profilesCmd.helpCommand(false);

  profilesCmd
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser profiles',
      '  opencli browser profiles --format json',
      '  opencli browser profiles rm zhihu',
      '  opencli browser profiles prune --temporary',
      '',
      'Notes:',
      '  Persistent profiles are created by `opencli browser launch --profile <name>`.',
      '  Temporary profiles come from `opencli browser launch` without `--profile`.',
    ].join('\n'))
    .action(async (opts) => {
      const profiles = await listBrowserProfiles();
      renderOutput(profiles.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        status: entry.status,
        ports: entry.ports.join(', '),
        lastUsedAt: entry.lastUsedAt,
        path: entry.path,
      })), {
        fmt: opts.format,
        columns: ['name', 'kind', 'status', 'ports', 'lastUsedAt', 'path'],
        title: 'opencli/browser/profiles',
        source: 'opencli browser profiles',
      });
    });

  profilesCmd
    .command('rm <name>')
    .description('Remove a named persistent browser profile')
    .action(async (name) => {
      const report = await removeBrowserProfile(name);
      console.log(renderRemoveBrowserProfileReport(report));
      process.exitCode = report.issues.length > 0 ? 1 : 0;
    });

  profilesCmd
    .command('prune')
    .description('Remove unused temporary browser profiles')
    .option('--temporary', 'Prune temporary profiles', false)
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser profiles prune --temporary',
      '',
      'Notes:',
      '  This only removes temporary profiles that are not in use.',
      '  It does not stop running browser processes.',
    ].join('\n'))
    .action(async (opts) => {
      if (!opts.temporary) {
        throw new CliError('INVALID_ARGUMENT', 'Choose a prune target. Use --temporary.');
      }

      const report = await pruneTemporaryProfiles();
      console.log(renderPruneTemporaryProfilesReport(report));
      process.exitCode = report.issues.length > 0 ? 1 : 0;
    });

  addBrowserRuntimeOptions(
    browserCmd
      .command('run')
      .description('Run an existing opencli command with a selected browser backend')
      .argument('[command...]', 'Existing opencli command to forward after --'),
  )
    .allowExcessArguments()
    .addHelpText('after', [
      '',
      'Examples:',
      '  opencli browser run --backend extension -- zhihu search --keyword AI',
      '  opencli browser run --backend cdp --cdp-endpoint http://127.0.0.1:9222 -- zhihu search --keyword AI',
      '',
      'Notes:',
      '  Everything after `--` is forwarded to the existing opencli command unchanged.',
      '  This command is additive: it does not modify the original command surface.',
    ].join('\n'))
    .action(async (_commandArgs, opts) => {
      const forwardedArgs = extractPassthroughArgs();
      const exitCode = await runOpenCliWithBrowserBackend({
        backend: opts.backend,
        cdpEndpoint: opts.cdpEndpoint,
        cdpTarget: opts.cdpTarget,
        forwardedArgs,
      });
      process.exitCode = exitCode;
    });

  // ── External CLIs ─────────────────────────────────────────────────────────

  const externalClis = loadExternalClis();

  program
    .command('install')
    .description('Install an external CLI')
    .argument('<name>', 'Name of the external CLI')
    .action((name: string) => {
      const ext = externalClis.find(e => e.name === name);
      if (!ext) {
        console.error(chalk.red(`External CLI '${name}' not found in registry.`));
        process.exitCode = 1;
        return;
      }
      installExternalCli(ext);
    });

  program
    .command('register')
    .description('Register an external CLI')
    .argument('<name>', 'Name of the CLI')
    .option('--binary <bin>', 'Binary name if different from name')
    .option('--install <cmd>', 'Auto-install command')
    .option('--desc <text>', 'Description')
    .action((name, opts) => {
      registerExternalCli(name, { binary: opts.binary, install: opts.install, description: opts.desc });
    });

  function passthroughExternal(name: string) {
    const idx = process.argv.indexOf(name);
    const args = process.argv.slice(idx + 1);
    try {
      executeExternalCli(name, args, externalClis);
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exitCode = 1;
    }
  }

  for (const ext of externalClis) {
    if (program.commands.some(c => c.name() === ext.name)) continue;
    program
      .command(ext.name)
      .description(`(External) ${ext.description || ext.name}`)
      .allowUnknownOption()
      .allowExcessArguments()
      .action(() => passthroughExternal(ext.name));
  }

  // ── Antigravity serve (long-running, special case) ────────────────────────

  const antigravityCmd = program.command('antigravity').description('antigravity commands');
  antigravityCmd
    .command('serve')
    .description('Start Anthropic-compatible API proxy for Antigravity')
    .option('--port <port>', 'Server port (default: 8082)', '8082')
    .action(async (opts) => {
      const { startServe } = await import('./clis/antigravity/serve.js');
      await startServe({ port: parseInt(opts.port) });
    });

  // ── Dynamic adapter commands ──────────────────────────────────────────────

  const siteGroups = new Map<string, Command>();
  siteGroups.set('antigravity', antigravityCmd);
  registerAllCommands(program, siteGroups);

  // ── Unknown command fallback ──────────────────────────────────────────────

  const DENY_LIST = new Set([
    'rm', 'sudo', 'dd', 'mkfs', 'fdisk', 'shutdown', 'reboot',
    'kill', 'killall', 'chmod', 'chown', 'passwd', 'su', 'mount',
    'umount', 'format', 'diskutil',
  ]);

  program.on('command:*', (operands: string[]) => {
    const binary = operands[0];
    if (DENY_LIST.has(binary)) {
      console.error(chalk.red(`Refusing to register system command '${binary}'.`));
      process.exitCode = 1;
      return;
    }
    if (isBinaryInstalled(binary)) {
      console.log(chalk.cyan(`🔹 Auto-discovered local CLI '${binary}'. Registering...`));
      registerExternalCli(binary);
      passthroughExternal(binary);
    } else {
      console.error(chalk.red(`error: unknown command '${binary}'`));
      program.outputHelp();
      process.exitCode = 1;
    }
  });

  program.parse();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Infer a workspace-friendly hostname from a URL, with site override. */
function inferHost(url: string, site?: string): string {
  if (site) return site;
  try { return new URL(url).host; } catch { return 'default'; }
}
