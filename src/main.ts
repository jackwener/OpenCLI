#!/usr/bin/env node
/**
 * opencli — Make any website your CLI. AI-powered.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import { discoverClis, executeCommand } from './engine.js';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { render as renderOutput } from './output.js';
import './clis/index.js';
import { PlaywrightMCP } from './browser.js';
import { browserSession, DEFAULT_BROWSER_COMMAND_TIMEOUT, runWithTimeout } from './runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILTIN_CLIS = path.resolve(__dirname, 'clis');
const USER_CLIS = path.join(os.homedir(), '.opencli', 'clis');

// Read version from package.json (single source of truth)
const pkgJsonPath = path.resolve(__dirname, '..', 'package.json');
const PKG_VERSION = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).version ?? '0.0.0';

discoverClis(BUILTIN_CLIS, USER_CLIS);

const program = new Command();
program.name('opencli').description('Make any website your CLI. Zero setup. AI-powered.').version(PKG_VERSION);

// ── Built-in commands ──────────────────────────────────────────────────────

program.command('list').description('List all available CLI commands').option('--json', 'JSON output')
  .action((opts) => {
    const registry = getRegistry();
    const commands = [...registry.values()].sort((a, b) => fullName(a).localeCompare(fullName(b)));
    if (opts.json) { console.log(JSON.stringify(commands.map(c => ({ command: fullName(c), site: c.site, name: c.name, description: c.description, strategy: strategyLabel(c), browser: c.browser, args: c.args.map(a => a.name) })), null, 2)); return; }
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
  .action(async (target) => { const { validateClisWithTarget, renderValidationReport } = await import('./validate.js'); console.log(renderValidationReport(validateClisWithTarget([BUILTIN_CLIS, USER_CLIS], target))); });

program.command('verify').description('Validate + smoke test').argument('[target]').option('--smoke', 'Run smoke tests', false)
  .action(async (target, opts) => { const { verifyClis, renderVerifyReport } = await import('./verify.js'); const r = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target, smoke: opts.smoke }); console.log(renderVerifyReport(r)); process.exitCode = r.ok ? 0 : 1; });

program.command('explore').alias('probe').description('Explore a website: discover APIs, stores, and recommend strategies').argument('<url>').option('--site <name>').option('--goal <text>').option('--wait <s>', '', '3')
  .action(async (url, opts) => { const { exploreUrl, renderExploreSummary } = await import('./explore.js'); console.log(renderExploreSummary(await exploreUrl(url, { BrowserFactory: PlaywrightMCP, site: opts.site, goal: opts.goal, waitSeconds: parseFloat(opts.wait) }))); });

program.command('synthesize').description('Synthesize CLIs from explore').argument('<target>').option('--top <n>', '', '3')
  .action(async (target, opts) => { const { synthesizeFromExplore, renderSynthesizeSummary } = await import('./synthesize.js'); console.log(renderSynthesizeSummary(synthesizeFromExplore(target, { top: parseInt(opts.top) }))); });

program.command('generate').description('One-shot: explore → synthesize → register').argument('<url>').option('--goal <text>').option('--site <name>')
  .action(async (url, opts) => { const { generateCliFromUrl, renderGenerateSummary } = await import('./generate.js'); const r = await generateCliFromUrl({ url, BrowserFactory: PlaywrightMCP, builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, goal: opts.goal, site: opts.site }); console.log(renderGenerateSummary(r)); process.exitCode = r.ok ? 0 : 1; });

program.command('cascade').description('Strategy cascade: find simplest working strategy').argument('<url>').option('--site <name>')
  .action(async (url, opts) => {
    const { cascadeProbe, renderCascadeResult } = await import('./cascade.js');
    const result = await browserSession(PlaywrightMCP, async (page) => {
      // Navigate to the site first for cookie context
      try { const siteUrl = new URL(url); await page.goto(`${siteUrl.protocol}//${siteUrl.host}`); await page.wait(2); } catch {}
      return cascadeProbe(page, url);
    });
    console.log(renderCascadeResult(result));
  });

// ── Dynamic site commands ──────────────────────────────────────────────────

const registry = getRegistry();
const siteGroups = new Map<string, Command>();

for (const [, cmd] of registry) {
  let siteCmd = siteGroups.get(cmd.site);
  if (!siteCmd) { siteCmd = program.command(cmd.site).description(`${cmd.site} commands`); siteGroups.set(cmd.site, siteCmd); }
  const subCmd = siteCmd.command(cmd.name).description(cmd.description);

  for (const arg of cmd.args) {
    const flag = arg.required ? `--${arg.name} <value>` : `--${arg.name} [value]`;
    if (arg.required) subCmd.requiredOption(flag, arg.help ?? '');
    else if (arg.default != null) subCmd.option(flag, arg.help ?? '', String(arg.default));
    else subCmd.option(flag, arg.help ?? '');
  }
  subCmd.option('-f, --format <fmt>', 'Output format: table, json, md, csv', 'table').option('-v, --verbose', 'Debug output', false);

  subCmd.action(async (actionOpts) => {
    const startTime = Date.now();
    const kwargs: Record<string, any> = {};
    for (const arg of cmd.args) {
      const v = actionOpts[arg.name]; if (v !== undefined) kwargs[arg.name] = coerce(v, arg.type ?? 'str');
      else if (arg.default != null) kwargs[arg.name] = arg.default;
    }
    try {
      let result: any;
      if (cmd.browser) {
        result = await browserSession(PlaywrightMCP, async (page) => runWithTimeout(executeCommand(cmd, page, kwargs, actionOpts.verbose), { timeout: cmd.timeoutSeconds ?? DEFAULT_BROWSER_COMMAND_TIMEOUT, label: fullName(cmd) }));
      } else { result = await executeCommand(cmd, null, kwargs, actionOpts.verbose); }
      renderOutput(result, { fmt: actionOpts.format, columns: cmd.columns, title: `${cmd.site}/${cmd.name}`, elapsed: (Date.now() - startTime) / 1000, source: fullName(cmd) });
    } catch (err: any) { console.error(chalk.red(`Error: ${err.message ?? err}`)); process.exitCode = 1; }
  });
}

function coerce(v: any, t: string): any {
  if (t === 'bool') return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  if (t === 'int') return parseInt(String(v), 10);
  if (t === 'float') return parseFloat(String(v));
  return String(v);
}

program.parse();
