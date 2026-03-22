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

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  const program = new Command();
  // enablePositionalOptions: prevents parent from consuming flags meant for subcommands;
  // prerequisite for passThroughOptions to forward --help/--version to external binaries
  program
    .name('opencli')
    .description('Make any website your CLI. Zero setup. AI-powered.')
    .version(PKG_VERSION)
    .enablePositionalOptions();

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
        BrowserFactory: getBrowserFactory(),
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
        BrowserFactory: getBrowserFactory(),
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

  // ── Built-in: browser state management ────────────────────────────────────

  const browserCmd = program.command('browser').description('Browser state management');

  browserCmd
    .command('export-state')
    .description('Export browser state (cookies, storage, IndexedDB) to JSON')
    .option('-d, --domain <domain>', 'Filter cookies by domain')
    .option('-o, --output <file>', 'Output file path', 'browser-state.json')
    .action(async (opts) => {
      const fs = await import('node:fs');
      const BrowserFactory = getBrowserFactory();
      const state = await browserSession(BrowserFactory, async (page) => {
        if (opts.domain) {
          try { await page.goto(`https://${opts.domain}`); await page.wait(2); } catch {}
        }
        return page.exportState({ domain: opts.domain });
      }, { workspace: 'state:export' });
      fs.writeFileSync(opts.output, JSON.stringify(state, null, 2));
      const stats = {
        cookies: state.cookies?.length ?? 0,
        localStorage: Object.keys(state.localStorage ?? {}).length,
        sessionStorage: Object.keys(state.sessionStorage ?? {}).length,
        indexedDB: (state.indexedDB ?? []).length,
      };
      console.log(chalk.green(`✅ Browser state exported to ${opts.output}`));
      console.log(chalk.dim(`   ${stats.cookies} cookies, ${stats.localStorage} localStorage, ${stats.sessionStorage} sessionStorage, ${stats.indexedDB} IndexedDB databases`));
    });

  browserCmd
    .command('import-state')
    .description('Import browser state from JSON file')
    .argument('<file>', 'Path to browser state JSON file')
    .action(async (file) => {
      const fs = await import('node:fs');
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`File not found: ${file}`));
        process.exitCode = 1;
        return;
      }
      const state = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const BrowserFactory = getBrowserFactory();
      await browserSession(BrowserFactory, async (page) => {
        await page.importState(state);
      }, { workspace: 'state:import' });
      console.log(chalk.green(`✅ Browser state imported from ${file}`));
    });

  browserCmd
    .command('sync')
    .description('Sync browser state from Chrome to Camoufox')
    .option('-d, --domain <domain>', 'Filter by domain')
    .action(async (opts) => {
      // Step 1: Export from Chrome (daemon mode)
      const { BrowserBridge } = await import('./browser/index.js');
      const chromeBridge = new BrowserBridge();
      let state;
      try {
        const chromePage = await chromeBridge.connect({ workspace: 'state:sync-export' });
        if (opts.domain) {
          try { await chromePage.goto(`https://${opts.domain}`); await chromePage.wait(2); } catch {}
        }
        state = await chromePage.exportState({ domain: opts.domain });
        console.log(chalk.cyan(`📤 Exported from Chrome: ${state.cookies.length} cookies, ${Object.keys(state.localStorage).length} localStorage entries`));
      } finally {
        await chromeBridge.close().catch(() => {});
      }

      // Step 2: Import to Camoufox
      const wsEndpoint = process.env.OPENCLI_CAMOUFOX_WS;
      if (!wsEndpoint) {
        // Save to file if camoufox is not running
        const fs = await import('node:fs');
        const outFile = `${opts.domain || 'browser'}-state.json`;
        fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
        console.log(chalk.yellow(`⚠️  Camoufox not running (OPENCLI_CAMOUFOX_WS not set). State saved to ${outFile}`));
        console.log(chalk.dim(`   Start camoufox, then: opencli browser import-state ${outFile}`));
        return;
      }

      const { CamoufoxBridge } = await import('./browser/index.js');
      const cfBridge = new CamoufoxBridge();
      try {
        const cfPage = await cfBridge.connect({ workspace: 'state:sync-import' });
        await cfPage.importState(state);
        console.log(chalk.green(`📥 Imported to Camoufox — login state synced!`));
      } finally {
        await cfBridge.close().catch(() => {});
      }
    });

  // ── Built-in: camoufox lifecycle ──────────────────────────────────────────

  const camoufoxCmd = program.command('camoufox').description('Manage Camoufox browser');

  camoufoxCmd
    .command('setup')
    .description('Install Camoufox (requires Python)')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      try {
        // Check Python
        try {
          execSync('python3 --version', { stdio: 'pipe' });
        } catch {
          console.error(chalk.red('Python 3 is required but not found. Install it first.'));
          process.exitCode = 1;
          return;
        }

        console.log(chalk.cyan('📦 Installing camoufox...'));
        execSync('pip3 install -U camoufox', { stdio: 'inherit' });

        console.log(chalk.cyan('📥 Fetching camoufox browser...'));
        execSync('python3 -m camoufox fetch', { stdio: 'inherit' });

        console.log(chalk.green('✅ Camoufox installed successfully!'));
        console.log(chalk.dim('   Start with: opencli camoufox start'));
      } catch (err: any) {
        console.error(chalk.red(`Setup failed: ${err.message}`));
        process.exitCode = 1;
      }
    });

  camoufoxCmd
    .command('start')
    .description('Start Camoufox server')
    .option('-p, --port <port>', 'WebSocket port', '19826')
    .option('--headless', 'Run headless', true)
    .option('--import <file>', 'Import state file after starting')
    .action(async (opts) => {
      const { spawn } = await import('node:child_process');
      const port = opts.port;

      console.log(chalk.cyan(`🦊 Starting Camoufox server on port ${port}...`));

      const headlessFlag = opts.headless ? '--headless' : '';
      const child = spawn('python3', [
        '-m', 'camoufox', 'server',
        '--port', port,
        ...(headlessFlag ? [headlessFlag] : []),
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      child.unref();

      // Wait for server to be ready
      const wsEndpoint = `ws://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const { firefox } = await import('playwright-core');
          const browser = await firefox.connect(wsEndpoint, { timeout: 2000 });
          await browser.close();
          ready = true;
          break;
        } catch { /* not ready yet */ }
      }

      if (!ready) {
        console.error(chalk.red('Camoufox failed to start within 30 seconds.'));
        process.exitCode = 1;
        return;
      }

      console.log(chalk.green(`✅ Camoufox running at ${wsEndpoint}`));
      console.log(chalk.dim(`   Set: export OPENCLI_CAMOUFOX_WS=${wsEndpoint}`));
      console.log(chalk.dim(`   PID: ${child.pid}`));

      // Import state if requested
      if (opts.import) {
        const fs = await import('node:fs');
        if (fs.existsSync(opts.import)) {
          const state = JSON.parse(fs.readFileSync(opts.import, 'utf-8'));
          const { CamoufoxBridge } = await import('./browser/index.js');
          process.env.OPENCLI_CAMOUFOX_WS = wsEndpoint;
          const bridge = new CamoufoxBridge();
          try {
            const page = await bridge.connect({ workspace: 'camoufox:import' });
            await page.importState(state);
            console.log(chalk.green(`📥 State imported from ${opts.import}`));
          } finally {
            await bridge.close().catch(() => {});
          }
        } else {
          console.error(chalk.yellow(`⚠️  State file not found: ${opts.import}`));
        }
      }
    });

  camoufoxCmd
    .command('status')
    .description('Check Camoufox server status')
    .option('-p, --port <port>', 'WebSocket port', '19826')
    .action(async (opts) => {
      const wsEndpoint = process.env.OPENCLI_CAMOUFOX_WS ?? `ws://127.0.0.1:${opts.port}`;
      try {
        const { firefox } = await import('playwright-core');
        const browser = await firefox.connect(wsEndpoint, { timeout: 3000 });
        const version = browser.version();
        await browser.close();
        console.log(chalk.green(`✅ Camoufox running at ${wsEndpoint}`));
        console.log(chalk.dim(`   Browser version: ${version}`));
      } catch {
        console.log(chalk.yellow(`❌ Camoufox not running at ${wsEndpoint}`));
        console.log(chalk.dim('   Start with: opencli camoufox start'));
      }
    });

  // ── Plugin management ──────────────────────────────────────────────────────

  const pluginCmd = program.command('plugin').description('Manage opencli plugins');

  pluginCmd
    .command('install')
    .description('Install a plugin from GitHub')
    .argument('<source>', 'Plugin source (e.g. github:user/repo)')
    .action(async (source: string) => {
      const { installPlugin } = await import('./plugin.js');
      try {
        const name = installPlugin(source);
        console.log(chalk.green(`✅ Plugin "${name}" installed successfully.`));
        console.log(chalk.dim(`   Restart opencli to use the new commands.`));
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exitCode = 1;
      }
    });

  pluginCmd
    .command('uninstall')
    .description('Uninstall a plugin')
    .argument('<name>', 'Plugin name')
    .action(async (name: string) => {
      const { uninstallPlugin } = await import('./plugin.js');
      try {
        uninstallPlugin(name);
        console.log(chalk.green(`✅ Plugin "${name}" uninstalled.`));
      } catch (err: any) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exitCode = 1;
      }
    });

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts) => {
      const { listPlugins } = await import('./plugin.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log(chalk.dim('  No plugins installed.'));
        console.log(chalk.dim(`  Install one with: opencli plugin install github:user/repo`));
        return;
      }
      if (opts.format === 'json') {
        renderOutput(plugins, {
          fmt: 'json',
          columns: ['name', 'commands', 'source'],
          title: 'opencli/plugins',
          source: 'opencli plugin list',
        });
        return;
      }
      console.log();
      console.log(chalk.bold('  Installed plugins'));
      console.log();
      for (const p of plugins) {
        const cmds = p.commands.length > 0 ? chalk.dim(` (${p.commands.join(', ')})`) : '';
        const src = p.source ? chalk.dim(` ← ${p.source}`) : '';
        console.log(`  ${chalk.cyan(p.name)}${cmds}${src}`);
      }
      console.log();
      console.log(chalk.dim(`  ${plugins.length} plugin(s) installed`));
      console.log();
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

  function passthroughExternal(name: string, parsedArgs?: string[]) {
    const args = parsedArgs ?? (() => {
      const idx = process.argv.indexOf(name);
      return process.argv.slice(idx + 1);
    })();
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
      .argument('[args...]')
      .allowUnknownOption()
      .passThroughOptions()
      .helpOption(false)
      .action((args: string[]) => passthroughExternal(ext.name, args));
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
