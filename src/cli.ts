import { Command } from 'commander';
import chalk from 'chalk';
import { executeCommand } from './engine.js';
import { Strategy, type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import { BrowserBridge, CDPBridge } from './browser/index.js';
import { browserSession, DEFAULT_BROWSER_COMMAND_TIMEOUT, runWithTimeout } from './runtime.js';
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { CliError } from './errors.js';

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  const program = new Command();
  program.name('opencli').description('Make any website your CLI. Zero setup. AI-powered.').version(PKG_VERSION);

  // ── Built-in commands ──────────────────────────────────────────────────────

  program.command('list').description('List all available CLI commands').option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table').option('--json', 'JSON output (deprecated)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...registry.values()].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const rows = commands.map(c => ({
        command: fullName(c),
        site: c.site,
        name: c.name,
        description: c.description,
        strategy: strategyLabel(c),
        browser: c.browser,
        args: c.args.map(a => a.name).join(', '),
      }));
      const fmt = opts.json && opts.format === 'table' ? 'json' : opts.format;
      if (fmt !== 'table') {
        renderOutput(rows, {
          fmt,
          columns: ['command', 'site', 'name', 'description', 'strategy', 'browser', 'args'],
          title: 'opencli/list',
          source: 'opencli list',
        });
        return;
      }
      const sites = new Map<string, CliCommand[]>();
      for (const cmd of commands) { const g = sites.get(cmd.site) ?? []; g.push(cmd); sites.set(cmd.site, g); }
      console.log(); console.log(chalk.bold('  opencli') + chalk.dim(' — available commands')); console.log();
      for (const [site, cmds] of sites) {
        console.log(chalk.bold.cyan(`  ${site}`));
        for (const cmd of cmds) { const tag = strategyLabel(cmd) === 'public' ? chalk.green('[public]') : chalk.yellow(`[${strategyLabel(cmd)}]`); console.log(`    ${cmd.name} ${tag}${cmd.description ? chalk.dim(` — ${cmd.description}`) : ''}`); }
        console.log();
      }
      console.log(chalk.dim(`  ${commands.length} commands across ${sites.size} sites`)); console.log();
    });

  program.command('validate').description('Validate CLI definitions').argument('[target]', 'site or site/name')
    .action(async (target) => {
      const { validateClisWithTarget, renderValidationReport } = await import('./validate.js');
      console.log(renderValidationReport(validateClisWithTarget([BUILTIN_CLIS, USER_CLIS], target)));
    });

  program.command('verify').description('Validate + smoke test').argument('[target]').option('--smoke', 'Run smoke tests', false)
    .action(async (target, opts) => {
      const { verifyClis, renderVerifyReport } = await import('./verify.js');
      const r = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target, smoke: opts.smoke });
      console.log(renderVerifyReport(r));
      process.exitCode = r.ok ? 0 : 1;
    });

  program.command('explore').alias('probe').description('Explore a website: discover APIs, stores, and recommend strategies').argument('<url>').option('--site <name>').option('--goal <text>').option('--wait <s>', '', '3').option('--auto', 'Enable interactive fuzzing (simulate clicks to trigger lazy APIs)').option('--click <labels>', 'Comma-separated labels to click before fuzzing (e.g. "字幕,CC,评论")')
    .action(async (url, opts) => { const { exploreUrl, renderExploreSummary } = await import('./explore.js'); const clickLabels = opts.click ? opts.click.split(',').map((s: string) => s.trim()) : undefined; const BrowserFactory = process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge; console.log(renderExploreSummary(await exploreUrl(url, { BrowserFactory: BrowserFactory as any, site: opts.site, goal: opts.goal, waitSeconds: parseFloat(opts.wait), auto: opts.auto, clickLabels }))); });

  program.command('synthesize').description('Synthesize CLIs from explore').argument('<target>').option('--top <n>', '', '3')
    .action(async (target, opts) => { const { synthesizeFromExplore, renderSynthesizeSummary } = await import('./synthesize.js'); console.log(renderSynthesizeSummary(synthesizeFromExplore(target, { top: parseInt(opts.top) }))); });

  program.command('generate').description('One-shot: explore → synthesize → register').argument('<url>').option('--goal <text>').option('--site <name>')
    .action(async (url, opts) => { const { generateCliFromUrl, renderGenerateSummary } = await import('./generate.js'); const BrowserFactory = process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge; const r = await generateCliFromUrl({ url, BrowserFactory: BrowserFactory as any, builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, goal: opts.goal, site: opts.site }); console.log(renderGenerateSummary(r)); process.exitCode = r.ok ? 0 : 1; });

  program.command('cascade').description('Strategy cascade: find simplest working strategy').argument('<url>').option('--site <name>')
    .action(async (url, opts) => {
      const { cascadeProbe, renderCascadeResult } = await import('./cascade.js');
      const BrowserFactory = process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge;
      const result = await browserSession(BrowserFactory as any, async (page) => {
        // Navigate to the site first for cookie context
        try { const siteUrl = new URL(url); await page.goto(`${siteUrl.protocol}//${siteUrl.host}`); await page.wait(2); } catch {}
        return cascadeProbe(page, url);
      });
      console.log(renderCascadeResult(result));
    });

  program.command('doctor')
    .description('Diagnose opencli browser bridge connectivity')
    .option('--live', 'Test browser connectivity (requires Chrome running)', false)
    .action(async (opts) => {
      const { runBrowserDoctor, renderBrowserDoctorReport } = await import('./doctor.js');
      const report = await runBrowserDoctor({ live: opts.live, cliVersion: PKG_VERSION });
      console.log(renderBrowserDoctorReport(report));
    });

  program.command('setup')
    .description('Interactive setup: verify browser bridge connectivity')
    .action(async () => {
      const { runSetup } = await import('./setup.js');
      await runSetup({ cliVersion: PKG_VERSION });
    });

  program.command('completion')
    .description('Output shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell) => {
      printCompletionScript(shell);
    });

  // ── Dynamic site commands ──────────────────────────────────────────────────

  const registry = getRegistry();
  const siteGroups = new Map<string, Command>();

  for (const [, cmd] of registry) {
    let siteCmd = siteGroups.get(cmd.site);
    if (!siteCmd) { siteCmd = program.command(cmd.site).description(`${cmd.site} commands`); siteGroups.set(cmd.site, siteCmd); }
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
    subCmd.option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table').option('-v, --verbose', 'Debug output', false);

    subCmd.action(async (...actionArgs: any[]) => {
      // Commander passes positional args first, then options object, then the Command
      const actionOpts = actionArgs[positionalArgs.length] ?? {};
      const startTime = Date.now();
      const kwargs: Record<string, any> = {};
      
      // Collect positional args
      for (let i = 0; i < positionalArgs.length; i++) {
        const arg = positionalArgs[i];
        const v = actionArgs[i];
        if (v !== undefined) kwargs[arg.name] = v;
      }
      
      // Collect named options
      for (const arg of cmd.args) {
        if (arg.positional) continue;
        const camelName = arg.name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
        const v = actionOpts[arg.name] ?? actionOpts[camelName];
        if (v !== undefined) kwargs[arg.name] = v;
      }

      try {
        if (actionOpts.verbose) process.env.OPENCLI_VERBOSE = '1';
        let result: any;
        if (cmd.browser) {
          const BrowserFactory = process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge;
          result = await browserSession(BrowserFactory as any, async (page) => {
            // Cookie/header strategies require same-origin context for credentialed fetch.
            if ((cmd.strategy === Strategy.COOKIE || cmd.strategy === Strategy.HEADER) && cmd.domain) {
              try { await page.goto(`https://${cmd.domain}`); await page.wait(2); } catch {}
            }
            return runWithTimeout(executeCommand(cmd, page, kwargs, actionOpts.verbose), { timeout: cmd.timeoutSeconds ?? DEFAULT_BROWSER_COMMAND_TIMEOUT, label: fullName(cmd) });
          });
        } else { result = await executeCommand(cmd, null, kwargs, actionOpts.verbose); }
        if (actionOpts.verbose && (!result || (Array.isArray(result) && result.length === 0))) {
          console.error(chalk.yellow(`[Verbose] Warning: Command returned an empty result. If the website structural API changed or requires authentication, check the network or update the adapter.`));
        }
        const resolved = getRegistry().get(fullName(cmd)) ?? cmd;
        renderOutput(result, { fmt: actionOpts.format, columns: resolved.columns, title: `${resolved.site}/${resolved.name}`, elapsed: (Date.now() - startTime) / 1000, source: fullName(resolved), footerExtra: resolved.footerExtra?.(kwargs) });
      } catch (err: any) { 
        if (err instanceof CliError) {
          console.error(chalk.red(`Error [${err.code}]: ${err.message}`));
          if (err.hint) console.error(chalk.yellow(`Hint: ${err.hint}`));
        } else if (actionOpts.verbose && err.stack) {
          console.error(chalk.red(err.stack));
        } else {
          console.error(chalk.red(`Error: ${err.message ?? err}`));
        }
        process.exitCode = 1; 
      }
    });
  }

  program.parse();
}
