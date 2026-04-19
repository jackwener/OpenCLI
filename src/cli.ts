/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in commands are registered inline here (list, validate, explore, etc.).
 * Dynamic adapter commands are registered via commanderAdapter.ts.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { styleText } from 'node:util';
import { findPackageRoot, getBuiltEntryCandidates } from './package-paths.js';
import { type CliCommand, fullName, getRegistry, strategyLabel } from './registry.js';
import { serializeCommand, formatArgSummary } from './serialization.js';
import { render as renderOutput } from './output.js';
import { getBrowserFactory, browserSession } from './runtime.js';
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { loadExternalClis, executeExternalCli, installExternalCli, registerExternalCli, isBinaryInstalled } from './external.js';
import { registerAllCommands } from './commanderAdapter.js';
import { EXIT_CODES, getErrorMessage, BrowserConnectError } from './errors.js';
import { TargetError } from './browser/target-errors.js';
import { resolveTargetJs, getTextResolvedJs, getValueResolvedJs, getAttributesResolvedJs, selectResolvedJs, isAutocompleteResolvedJs } from './browser/target-resolver.js';
import { daemonStatus, daemonStop } from './commands/daemon.js';
import { log } from './logger.js';

const CLI_FILE = fileURLToPath(import.meta.url);
const DEFAULT_BROWSER_WORKSPACE = 'browser:default';
const BROWSER_TAB_OPTION_DESCRIPTION = 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"';

type BrowserNetworkItem = {
  url: string;
  method: string;
  status: number;
  size: number;
  ct: string;
  body: unknown;
};

type BrowserTargetState = {
  defaultPage?: string;
  updatedAt: string;
};

type BrowserTabSummary = {
  page?: string;
};

function getBrowserCacheDir(): string {
  return process.env.OPENCLI_CACHE_DIR || path.join(os.homedir(), '.opencli', 'cache');
}

function getBrowserTargetStatePath(scope: string = DEFAULT_BROWSER_WORKSPACE): string {
  const safeWorkspace = scope.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return path.join(getBrowserCacheDir(), 'browser-state', `${safeWorkspace}.json`);
}

function loadBrowserTargetState(scope: string = DEFAULT_BROWSER_WORKSPACE): BrowserTargetState | null {
  try {
    const raw = fs.readFileSync(getBrowserTargetStatePath(scope), 'utf-8');
    const parsed = JSON.parse(raw) as BrowserTargetState | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveBrowserTargetState(defaultPage?: string, scope: string = DEFAULT_BROWSER_WORKSPACE): void {
  const target = getBrowserTargetStatePath(scope);
  if (!defaultPage) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ defaultPage, updatedAt: new Date().toISOString() }), 'utf-8');
}

function hasBrowserTabTarget(tabs: unknown[], targetPage: string): boolean {
  return tabs.some((tab) => {
    return typeof tab === 'object'
      && tab !== null
      && 'page' in tab
      && typeof (tab as BrowserTabSummary).page === 'string'
      && (tab as BrowserTabSummary).page === targetPage;
  });
}

async function resolveBrowserTargetInSession(
  page: import('./types.js').IPage,
  targetPage: string,
  opts: { scope?: string; source: 'explicit' | 'saved' },
): Promise<string | undefined> {
  const candidate = targetPage.trim();
  if (!candidate) return undefined;

  let tabs: unknown[];
  try {
    tabs = await page.tabs();
  } catch (err) {
    if (opts.source === 'saved') {
      saveBrowserTargetState(undefined, opts.scope);
      return undefined;
    }
    throw new Error(
      `Target tab ${candidate} could not be validated in the current browser session. ` +
      'The Browser Bridge workspace may have restarted; re-run "opencli browser tab list" and choose a current target.',
      { cause: err },
    );
  }

  if (Array.isArray(tabs) && hasBrowserTabTarget(tabs, candidate)) {
    return candidate;
  }

  if (opts.source === 'saved') {
    saveBrowserTargetState(undefined, opts.scope);
    return undefined;
  }

  throw new Error(
    `Target tab ${candidate} is not part of the current browser session. ` +
    'The Browser Bridge workspace may have restarted; re-run "opencli browser tab list" and choose a current target.',
  );
}

async function resolveStoredBrowserTarget(page: import('./types.js').IPage, scope: string = DEFAULT_BROWSER_WORKSPACE): Promise<string | undefined> {
  const defaultPage = loadBrowserTargetState(scope)?.defaultPage?.trim();
  if (!defaultPage) return undefined;
  return resolveBrowserTargetInSession(page, defaultPage, { scope, source: 'saved' });
}

/** Create a browser page for browser commands. Uses a dedicated browser workspace for session persistence. */
async function getBrowserPage(targetPage?: string): Promise<import('./types.js').IPage> {
  const { BrowserBridge } = await import('./browser/index.js');
  const bridge = new BrowserBridge();
  const envTimeout = process.env.OPENCLI_BROWSER_TIMEOUT;
  const idleTimeout = envTimeout ? parseInt(envTimeout, 10) : undefined;
  const page = await bridge.connect({
    timeout: 30,
    workspace: DEFAULT_BROWSER_WORKSPACE,
    ...(idleTimeout && idleTimeout > 0 && { idleTimeout }),
  });
  const resolvedTargetPage = targetPage
    ? await resolveBrowserTargetInSession(page, targetPage, { scope: DEFAULT_BROWSER_WORKSPACE, source: 'explicit' })
    : await resolveStoredBrowserTarget(page, DEFAULT_BROWSER_WORKSPACE);
  if (resolvedTargetPage) {
    if (!page.setActivePage) {
      throw new Error('This browser session does not support explicit tab targeting');
    }
    page.setActivePage(resolvedTargetPage);
  }
  return page;
}

function addBrowserTabOption(command: Command): Command {
  return command.option('--tab <targetId>', BROWSER_TAB_OPTION_DESCRIPTION);
}

function getBrowserTargetId(command?: Command): string | undefined {
  if (!command) return undefined;
  const opts = command.optsWithGlobals ? command.optsWithGlobals() : command.opts();
  return typeof opts.tab === 'string' && opts.tab.trim() ? opts.tab.trim() : undefined;
}

function resolveBrowserTabTarget(targetId?: string, opts?: { tab?: string }): string | undefined {
  if (typeof targetId === 'string' && targetId.trim()) return targetId.trim();
  if (typeof opts?.tab === 'string' && opts.tab.trim()) return opts.tab.trim();
  return undefined;
}

function parsePositiveIntOption(val: string | undefined, label: string, fallback: number): number {
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.error(`[cli] Invalid ${label}="${val}", using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function applyVerbose(opts: { verbose?: boolean }): void {
  if (opts.verbose) process.env.OPENCLI_VERBOSE = '1';
}

export function createProgram(BUILTIN_CLIS: string, USER_CLIS: string): Command {
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
    .option('-f, --format <fmt>', 'Output format: yaml, json, table, md, csv', 'yaml')
    .option('--json', 'JSON output (deprecated)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...new Set(registry.values())].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const fmt = opts.json ? 'json' : opts.format;
      const isStructured = fmt === 'json' || fmt === 'yaml';

      if (fmt !== 'table') {
        const rows = isStructured
          ? commands.map(serializeCommand)
          : commands.map(c => ({
              command: fullName(c),
              site: c.site,
              name: c.name,
              aliases: c.aliases?.join(', ') ?? '',
              description: c.description,
              strategy: strategyLabel(c),
              browser: !!c.browser,
              args: formatArgSummary(c.args),
            }));
        renderOutput(rows, {
          fmt,
          columns: ['command', 'site', 'name', 'aliases', 'description', 'strategy', 'browser', 'args',
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
      console.log(styleText('bold', '  opencli') + styleText('dim', ' — available commands'));
      console.log();
      for (const [site, cmds] of sites) {
        console.log(styleText(['bold', 'cyan'], `  ${site}`));
        for (const cmd of cmds) {
          const label = strategyLabel(cmd);
          const tag = label === 'public'
            ? styleText('green', '[public]')
            : styleText('yellow', `[${label}]`);
          const aliases = cmd.aliases?.length ? styleText('dim', ` (aliases: ${cmd.aliases.join(', ')})`) : '';
          console.log(`    ${cmd.name} ${tag}${aliases}${cmd.description ? styleText('dim', ` — ${cmd.description}`) : ''}`);
        }
        console.log();
      }

      const externalClis = loadExternalClis();
      if (externalClis.length > 0) {
        console.log(styleText(['bold', 'cyan'], '  external CLIs'));
        for (const ext of externalClis) {
          const isInstalled = isBinaryInstalled(ext.binary);
          const tag = isInstalled ? styleText('green', '[installed]') : styleText('yellow', '[auto-install]');
          console.log(`    ${ext.name} ${tag}${ext.description ? styleText('dim', ` — ${ext.description}`) : ''}`);
        }
        console.log();
      }

      console.log(styleText('dim', `  ${commands.length} built-in commands across ${sites.size} sites, ${externalClis.length} external CLIs`));
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
      process.exitCode = r.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
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
    .option('-v, --verbose', 'Debug output')
    .action(async (url: string, opts: {
      site?: string;
      goal?: string;
      wait: string;
      auto?: boolean;
      click?: string;
      verbose?: boolean;
    }) => {
      applyVerbose(opts);
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
    .option('-v, --verbose', 'Debug output')
    .action(async (target, opts) => {
      applyVerbose(opts);
      const { synthesizeFromExplore, renderSynthesizeSummary } = await import('./synthesize.js');
      console.log(renderSynthesizeSummary(synthesizeFromExplore(target, { top: parseInt(opts.top) })));
    });

  program
    .command('generate')
    .description('One-shot: explore → synthesize → verify → register')
    .argument('<url>')
    .option('--goal <text>')
    .option('--site <name>')
    .option('--format <fmt>', 'Output format: table, json', 'table')
    .option('--no-register', 'Verify the generated adapter without registering it')
    .option('-v, --verbose', 'Debug output')
    .action(async (url: string, opts: {
      goal?: string;
      site?: string;
      format?: string;
      register?: boolean;
      verbose?: boolean;
    }) => {
      applyVerbose(opts);
      const { generateVerifiedFromUrl, renderGenerateVerifiedSummary } = await import('./generate-verified.js');
      const workspace = `generate:${inferHost(url, opts.site)}`;
      const r = await generateVerifiedFromUrl({
        url,
        BrowserFactory: getBrowserFactory(),
        goal: opts.goal,
        site: opts.site,
        workspace,
        noRegister: opts.register === false,
      });
      if (opts.format === 'json') console.log(JSON.stringify(r, null, 2));
      else console.log(renderGenerateVerifiedSummary(r));
      process.exitCode = r.status === 'success' ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
    });

  // ── Built-in: record ─────────────────────────────────────────────────────

  program
    .command('record')
    .description('Record API calls from a live browser session → generate YAML candidates')
    .argument('<url>', 'URL to open and record')
    .option('--site <name>', 'Site name (inferred from URL if omitted)')
    .option('--out <dir>', 'Output directory for candidates')
    .option('--poll <ms>', 'Poll interval in milliseconds', '2000')
    .option('--timeout <ms>', 'Auto-stop after N milliseconds (default: 60000)', '60000')
    .option('-v, --verbose', 'Debug output')
    .action(async (url: string, opts: {
      site?: string;
      out?: string;
      poll: string;
      timeout: string;
      verbose?: boolean;
    }) => {
      applyVerbose(opts);
      const { recordSession, renderRecordSummary } = await import('./record.js');
      const result = await recordSession({
        BrowserFactory: getBrowserFactory(),
        url,
        site: opts.site,
        outDir: opts.out,
        pollMs: parseInt(opts.poll, 10),
        timeoutMs: parseInt(opts.timeout, 10),
      });
      console.log(renderRecordSummary(result));
      process.exitCode = result.candidateCount > 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.EMPTY_RESULT;
    });

  program
    .command('cascade')
    .description('Strategy cascade: find simplest working strategy')
    .argument('<url>')
    .option('--site <name>')
    .option('-v, --verbose', 'Debug output')
    .action(async (url: string, opts: {
      site?: string;
      verbose?: boolean;
    }) => {
      applyVerbose(opts);
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

  // ── Built-in: browser (browser control for Claude Code skill) ───────────────
  //
  // Make websites accessible for AI agents.
  // All commands wrapped in browserAction() for consistent error handling.

  const browser = program
    .command('browser')
    .description('Browser control — navigate, click, type, extract, wait (no LLM needed)');

  /** Resolve a ref/CSS target via the unified resolver, throwing TargetError on failure. */
  async function resolveRef(page: Awaited<ReturnType<typeof getBrowserPage>>, ref: string): Promise<void> {
    const resolution = await page.evaluate(resolveTargetJs(ref)) as
      | { ok: true }
      | { ok: false; code: string; message: string; hint: string; candidates?: string[] };
    if (!resolution.ok) {
      throw new TargetError(resolution as { ok: false; code: 'not_found' | 'ambiguous' | 'stale_ref'; message: string; hint: string; candidates?: string[] });
    }
  }

  /** Wrap browser actions with error handling and optional --json output */
  function browserAction(fn: (page: Awaited<ReturnType<typeof getBrowserPage>>, ...args: any[]) => Promise<unknown>) {
    return async (...args: any[]) => {
      try {
        const command = args.at(-1) instanceof Command ? args.at(-1) as Command : undefined;
        const targetPage = getBrowserTargetId(command);
        const page = await getBrowserPage(targetPage);
        await fn(page, ...args);
      } catch (err) {
        if (err instanceof BrowserConnectError) {
          log.error(err.message);
          if (err.hint) log.error(`Hint: ${err.hint}`);
        } else if (err instanceof TargetError) {
          log.error(`[${err.code}] ${err.message}`);
          if (err.hint) log.error(`Hint: ${err.hint}`);
          if (err.candidates?.length) {
            log.error('Candidates:');
            err.candidates.forEach((c, i) => log.error(`  ${i + 1}. ${c}`));
          }
        } else {
          const msg = getErrorMessage(err);
          if (msg.includes('attach failed') || msg.includes('chrome-extension://')) {
            log.error(`Browser attach failed — another extension may be interfering. Try disabling 1Password.`);
          } else {
            log.error(msg);
          }
        }
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    };
  }

  const browserTab = browser
    .command('tab')
    .description('Tab management — list, create, and close tabs in the automation window');

  browserTab.command('list')
    .description('List tabs in the automation window with target IDs')
    .action(browserAction(async (page) => {
      const tabs = await page.tabs();
      console.log(JSON.stringify(tabs, null, 2));
    }));

  browserTab.command('new')
    .argument('[url]', 'Optional URL to open in the new tab')
    .description('Create a new tab and print its target ID')
    .action(browserAction(async (page, url?: string) => {
      if (!page.newTab) {
        throw new Error('This browser session does not support creating tabs');
      }
      const createdPage = await page.newTab(url);
      console.log(JSON.stringify({
        page: createdPage,
        url: url ?? null,
      }, null, 2));
    }));

  addBrowserTabOption(browserTab.command('select')
    .argument('[targetId]', 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"')
    .description('Select a tab by target ID and make it the default browser tab'))
    .action(browserAction(async (page, targetId?: string, opts?: { tab?: string }) => {
      const resolvedTarget = resolveBrowserTabTarget(targetId, opts);
      if (!resolvedTarget) {
        throw new Error('Target tab required. Pass it as an argument or --tab <targetId>.');
      }
      await page.selectTab(resolvedTarget);
      saveBrowserTargetState(resolvedTarget, DEFAULT_BROWSER_WORKSPACE);
      console.log(JSON.stringify({ selected: resolvedTarget }, null, 2));
    }));

  addBrowserTabOption(browserTab.command('close')
    .argument('[targetId]', 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"')
    .description('Close a tab by target ID'))
    .action(browserAction(async (page, targetId?: string, opts?: { tab?: string }) => {
      const resolvedTarget = resolveBrowserTabTarget(targetId, opts);
      if (!page.closeTab) {
        throw new Error('This browser session does not support closing tabs');
      }
      if (!resolvedTarget) {
        throw new Error('Target tab required. Pass it as an argument or --tab <targetId>.');
      }
      const validatedTarget = await resolveBrowserTargetInSession(page, resolvedTarget, {
        scope: DEFAULT_BROWSER_WORKSPACE,
        source: 'explicit',
      });
      if (!validatedTarget) {
        throw new Error(`Target tab ${resolvedTarget} is not part of the current browser session.`);
      }
      await page.closeTab(validatedTarget);
      if (loadBrowserTargetState(DEFAULT_BROWSER_WORKSPACE)?.defaultPage === validatedTarget) {
        saveBrowserTargetState(undefined, DEFAULT_BROWSER_WORKSPACE);
      }
      console.log(JSON.stringify({ closed: validatedTarget }, null, 2));
    }));

  // ── Navigation ──

  /** Network interceptor JS — injected on every open/navigate to capture fetch/XHR */
  const NETWORK_INTERCEPTOR_JS = `(function(){if(window.__opencli_net)return;window.__opencli_net=[];var M=200,B=50000,F=window.fetch;window.fetch=async function(){var r=await F.apply(this,arguments);try{var ct=r.headers.get('content-type')||'';if(ct.includes('json')||ct.includes('text')){var c=r.clone(),t=await c.text();if(window.__opencli_net.length<M){var b=null;if(t.length<=B)try{b=JSON.parse(t)}catch(e){b=t}window.__opencli_net.push({url:r.url||(arguments[0]&&arguments[0].url)||String(arguments[0]),method:(arguments[1]&&arguments[1].method)||'GET',status:r.status,size:t.length,ct:ct,body:b})}}}catch(e){}return r};var X=XMLHttpRequest.prototype,O=X.open,S=X.send;X.open=function(m,u){this._om=m;this._ou=u;return O.apply(this,arguments)};X.send=function(){var x=this;x.addEventListener('load',function(){try{var ct=x.getResponseHeader('content-type')||'';if((ct.includes('json')||ct.includes('text'))&&window.__opencli_net.length<M){var t=x.responseText,b=null;if(t&&t.length<=B)try{b=JSON.parse(t)}catch(e){b=t}window.__opencli_net.push({url:x._ou,method:x._om||'GET',status:x.status,size:t?t.length:0,ct:ct,body:b})}}catch(e){}});return S.apply(this,arguments)}})()`;

  addBrowserTabOption(browser.command('open').argument('<url>').description('Open URL in automation window'))
    .action(browserAction(async (page, url) => {
      // Start session-level capture before navigation (catches initial requests)
      const hasSessionCapture = await page.startNetworkCapture?.() ?? false;
      await page.goto(url);
      await page.wait(2);
      // Fallback: inject JS interceptor when session capture is unavailable
      if (!hasSessionCapture) {
        try { await page.evaluate(NETWORK_INTERCEPTOR_JS); } catch { /* non-fatal */ }
      }
      console.log(JSON.stringify({
        url: await page.getCurrentUrl?.() ?? url,
        ...(page.getActivePage?.() ? { page: page.getActivePage?.() } : {}),
      }, null, 2));
    }));

  addBrowserTabOption(browser.command('back').description('Go back in browser history'))
    .action(browserAction(async (page) => {
      await page.evaluate('history.back()');
      await page.wait(2);
      console.log('Navigated back');
    }));

  addBrowserTabOption(browser.command('scroll').argument('<direction>', 'up or down').option('--amount <pixels>', 'Pixels to scroll', '500'))
    .description('Scroll page')
    .action(browserAction(async (page, direction, opts) => {
      if (direction !== 'up' && direction !== 'down') {
        console.error(`Invalid direction "${direction}". Use "up" or "down".`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      await page.scroll(direction, parseInt(opts.amount, 10));
      console.log(`Scrolled ${direction}`);
    }));

  // ── Inspect ──

  addBrowserTabOption(browser.command('state').description('Page state: URL, title, interactive elements with [N] indices'))
    .action(browserAction(async (page) => {
      const snapshot = await page.snapshot({ viewportExpand: 2000 });
      const url = await page.getCurrentUrl?.() ?? '';
      console.log(`URL: ${url}\n`);
      console.log(typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2));
    }));

  addBrowserTabOption(browser.command('frames').description('List cross-origin iframe targets in snapshot order'))
    .action(browserAction(async (page) => {
      const frames = await page.frames?.() ?? [];
      console.log(JSON.stringify(frames, null, 2));
    }));

  addBrowserTabOption(browser.command('screenshot').argument('[path]', 'Save to file (base64 if omitted)'))
    .description('Take screenshot')
    .action(browserAction(async (page, path) => {
      if (path) {
        await page.screenshot({ path });
        console.log(`Screenshot saved to: ${path}`);
      } else {
        console.log(await page.screenshot({ format: 'png' }));
      }
    }));

  // ── Get commands (structured data extraction) ──

  const get = browser.command('get').description('Get page properties');

  addBrowserTabOption(get.command('title').description('Page title'))
    .action(browserAction(async (page) => {
      console.log(await page.evaluate('document.title'));
    }));

  addBrowserTabOption(get.command('url').description('Current page URL'))
    .action(browserAction(async (page) => {
      console.log(await page.getCurrentUrl?.() ?? await page.evaluate('location.href'));
    }));

  addBrowserTabOption(get.command('text').argument('<index>', 'Element index').description('Element text content'))
    .action(browserAction(async (page, index) => {
      await resolveRef(page, String(index));
      const text = await page.evaluate(getTextResolvedJs());
      console.log(text ?? '(empty)');
    }));

  addBrowserTabOption(get.command('value').argument('<index>', 'Element index').description('Input/textarea value'))
    .action(browserAction(async (page, index) => {
      await resolveRef(page, String(index));
      const val = await page.evaluate(getValueResolvedJs());
      console.log(val ?? '(empty)');
    }));

  addBrowserTabOption(get.command('html').option('--selector <css>', 'CSS selector scope').description('Page HTML (or scoped)'))
    .action(browserAction(async (page, opts) => {
      const sel = opts.selector ? JSON.stringify(opts.selector) : 'null';
      const html = await page.evaluate(`(${sel} ? document.querySelector(${sel})?.outerHTML : document.documentElement.outerHTML)?.slice(0, 50000)`);
      console.log(html ?? '(empty)');
    }));

  addBrowserTabOption(get.command('attributes').argument('<index>', 'Element index').description('Element attributes'))
    .action(browserAction(async (page, index) => {
      await resolveRef(page, String(index));
      const attrs = await page.evaluate(getAttributesResolvedJs());
      console.log(attrs ?? '{}');
    }));

  // ── Interact ──

  addBrowserTabOption(browser.command('click').argument('<index>', 'Element index from state').description('Click element by index'))
    .action(browserAction(async (page, index) => {
      await page.click(index);
      console.log(`Clicked element [${index}]`);
    }));

  addBrowserTabOption(browser.command('type').argument('<index>', 'Element index').argument('<text>', 'Text to type'))
    .description('Click element, then type text')
    .action(browserAction(async (page, index, text) => {
      await page.click(index);
      await page.wait(0.3);
      await page.typeText(index, text);
      // Detect autocomplete/combobox fields and wait for dropdown suggestions
      // __resolved is already set by typeText's resolver call
      const isAutocomplete = await page.evaluate(isAutocompleteResolvedJs());
      if (isAutocomplete) {
        await page.wait(0.4);
        console.log(`Typed "${text}" into autocomplete [${index}] — use state to see suggestions`);
      } else {
        console.log(`Typed "${text}" into element [${index}]`);
      }
    }));

  addBrowserTabOption(browser.command('select').argument('<index>', 'Element index of <select>').argument('<option>', 'Option text'))
    .description('Select dropdown option')
    .action(browserAction(async (page, index, option) => {
      await resolveRef(page, String(index));
      const result = await page.evaluate(selectResolvedJs(option)) as { error?: string; selected?: string; available?: string[] } | null;
      if (result?.error) {
        console.error(`Error: ${result.error}${result.available ? ` — Available: ${result.available.join(', ')}` : ''}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      } else {
        console.log(`Selected "${result?.selected}" in element [${index}]`);
      }
    }));

  addBrowserTabOption(browser.command('keys').argument('<key>', 'Key to press (Enter, Escape, Tab, Control+a)'))
    .description('Press keyboard key')
    .action(browserAction(async (page, key) => {
      await page.pressKey(key);
      console.log(`Pressed: ${key}`);
    }));

  // ── Wait commands ──

  addBrowserTabOption(browser.command('wait'))
    .argument('<type>', 'selector, text, or time')
    .argument('[value]', 'CSS selector, text string, or seconds')
    .option('--timeout <ms>', 'Timeout in milliseconds', '10000')
    .description('Wait for selector, text, or time (e.g. wait selector ".loaded", wait text "Success", wait time 3)')
    .action(browserAction(async (page, type, value, opts) => {
      const timeout = parseInt(opts.timeout, 10);
      if (type === 'time') {
        const seconds = parseFloat(value ?? '2');
        await page.wait(seconds);
        console.log(`Waited ${seconds}s`);
      } else if (type === 'selector') {
        if (!value) { console.error('Missing CSS selector'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        await page.wait({ selector: value, timeout: timeout / 1000 });
        console.log(`Element "${value}" appeared`);
      } else if (type === 'text') {
        if (!value) { console.error('Missing text'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        await page.wait({ text: value, timeout: timeout / 1000 });
        console.log(`Text "${value}" appeared`);
      } else {
        console.error(`Unknown wait type "${type}". Use: selector, text, or time`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
      }
    }));

  // ── Extract ──

  addBrowserTabOption(
    browser.command('eval')
      .argument('<js>', 'JavaScript code')
      .option('--frame <index>', 'Cross-origin iframe index from "browser frames"')
      .description('Execute JS in page context, return result'),
  )
    .action(browserAction(async (page, js, opts) => {
      let result: unknown;
      if (opts.frame !== undefined) {
        const frameIndex = Number.parseInt(opts.frame, 10);
        if (!Number.isInteger(frameIndex) || frameIndex < 0) {
          console.error(`Invalid frame index "${opts.frame}". Use a 0-based index from "browser frames".`);
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        if (!page.evaluateInFrame) {
          throw new Error('This browser session does not support frame-targeted evaluation');
        }
        result = await page.evaluateInFrame(js, frameIndex);
      } else {
        result = await page.evaluate(js);
      }
      if (typeof result === 'string') console.log(result);
      else console.log(JSON.stringify(result, null, 2));
    }));

  // ── Network (API discovery) ──

  addBrowserTabOption(browser.command('network'))
    .option('--detail <index>', 'Show full response body of request at index')
    .option('--all', 'Show all requests including static resources')
    .description('Show captured network requests (auto-captured since last open)')
    .action(browserAction(async (page, opts) => {
      let items: BrowserNetworkItem[] = [];
      if (page.readNetworkCapture) {
        const raw = await page.readNetworkCapture();
        // Normalize daemon/CDP capture entries to __opencli_net shape.
        // Daemon returns: responseStatus, responseContentType, responsePreview
        // CDP returns the same shape after PR A fix.
        items = (raw as Array<Record<string, unknown>>).map(e => {
          const preview = (e.responsePreview as string) ?? null;
          let body: unknown = null;
          if (preview) {
            try { body = JSON.parse(preview); } catch { body = preview; }
          }
          return {
            url: (e.url as string) || '',
            method: (e.method as string) || 'GET',
            status: (e.responseStatus as number) || 0,
            size: preview ? preview.length : 0,
            ct: (e.responseContentType as string) || '',
            body,
          };
        });
      } else {
        // Fallback to JS interceptor data
        const requests = await page.evaluate(`(function(){
          var reqs = window.__opencli_net || [];
          return JSON.stringify(reqs);
        })()`) as string;
        try { items = JSON.parse(requests); } catch { console.log('No network data captured. Run "browser open <url>" first.'); return; }
      }

      if (items.length === 0) { console.log('No requests captured.'); return; }

      // Filter out static resources unless --all
      if (!opts.all) {
        items = items.filter(r =>
          (r.ct?.includes('json') || r.ct?.includes('xml') || r.ct?.includes('text/plain')) &&
          !/\.(js|css|png|jpg|gif|svg|woff|ico|map)(\?|$)/i.test(r.url) &&
          !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url)
        );
      }

      if (opts.detail !== undefined) {
        const idx = parseInt(opts.detail, 10);
        const req = items[idx];
        if (!req) { console.error(`Request #${idx} not found. ${items.length} requests available.`); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        console.log(`${req.method} ${req.url}`);
        console.log(`Status: ${req.status} | Size: ${req.size} | Type: ${req.ct}`);
        console.log('---');
        console.log(typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2));
      } else {
        console.log(`Captured ${items.length} API requests:\n`);
        items.forEach((r, i) => {
          const bodyPreview = r.body ? (typeof r.body === 'string' ? r.body.slice(0, 60) : JSON.stringify(r.body).slice(0, 60)) : '';
          console.log(`  [${i}] ${r.method} ${r.status} ${r.url.slice(0, 80)}`);
          if (bodyPreview) console.log(`      ${bodyPreview}...`);
        });
        console.log(`\nUse --detail <index> to see full response body.`);
      }
    }));

  // ── Init (adapter scaffolding) ──

  browser.command('init')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Generate adapter scaffold in ~/.opencli/clis/')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error('Name must be site/command format (e.g. hn/top)');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.join(os.homedir(), '.opencli', 'clis', site);
        const filePath = path.join(dir, `${command}.js`);

        if (fs.existsSync(filePath)) {
          console.log(`Adapter already exists: ${filePath}`);
          return;
        }

        // Try to detect domain from the last browser session
        let domain = site;
        try {
          const page = await getBrowserPage();
          const url = await page.getCurrentUrl?.();
          if (url) { try { domain = new URL(url).hostname; } catch {} }
        } catch { /* no active session */ }

        const template = `import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: '${site}',
  name: '${command}',
  description: '', // TODO: describe what this command does
  domain: '${domain}',
  strategy: Strategy.PUBLIC, // TODO: PUBLIC (no auth), COOKIE (needs login), UI (DOM interaction)
  browser: false,            // TODO: set true if needs browser
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: [], // TODO: field names for table output (e.g. ['title', 'score', 'url'])
  func: async (page, kwargs) => {
    // TODO: implement data fetching
    // Prefer API calls (fetch) over browser automation
    // page is available if browser: true
    return [];
  },
});
`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, template, 'utf-8');
        console.log(`Created: ${filePath}`);
        console.log(`Edit the file to implement your adapter, then run: opencli browser verify ${name}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Verify (test adapter) ──

  browser.command('verify')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Execute an adapter and show results')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2) { console.error('Name must be site/command format'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const { execFileSync } = await import('node:child_process');
        const os = await import('node:os');
        const filePath = path.join(os.homedir(), '.opencli', 'clis', site, `${command}.js`);
        if (!fs.existsSync(filePath)) {
          console.error(`Adapter not found: ${filePath}`);
          console.error(`Run "opencli browser init ${name}" to create it.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        console.log(`🔍 Verifying ${name}...\n`);
        console.log(`  Loading: ${filePath}`);

        // Read adapter to check if it defines a 'limit' arg
        const adapterSrc = fs.readFileSync(filePath, 'utf-8');
        const hasLimitArg = /['"]limit['"]/.test(adapterSrc);
        const limitFlag = hasLimitArg ? ' --limit 3' : '';
        const limitArgs = hasLimitArg ? ['--limit', '3'] : [];
        const invocation = resolveBrowserVerifyInvocation();

        try {
          const output = execFileSync(invocation.binary, [...invocation.args, site, command, ...limitArgs], {
            cwd: invocation.cwd,
            timeout: 30000,
            encoding: 'utf-8',
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            ...(invocation.shell ? { shell: true } : {}),
          });
          console.log(`  Executing: opencli ${site} ${command}${limitFlag}\n`);
          console.log(output);
          console.log(`\n  ✓ Adapter works!`);
        } catch (err) {
          console.log(`  Executing: opencli ${site} ${command}${limitFlag}\n`);
          // execFileSync attaches captured stdout/stderr on its thrown Error.
          const execErr = err as { stdout?: string | Buffer; stderr?: string | Buffer };
          if (execErr.stdout) console.log(String(execErr.stdout));
          if (execErr.stderr) console.error(String(execErr.stderr).slice(0, 500));
          console.log(`\n  ✗ Adapter failed. Fix the code and try again.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Session ──

  browser.command('close').description('Close the automation window')
    .action(browserAction(async (page) => {
      await page.closeWindow?.();
      console.log('Automation window closed');
    }));

  // ── Built-in: doctor / completion ──────────────────────────────────────────

  program
    .command('doctor')
    .description('Diagnose opencli browser bridge connectivity')
    .option('--no-live', 'Skip live browser connectivity test')
    .option('--sessions', 'Show active automation sessions', false)
    .option('-v, --verbose', 'Debug output')
    .action(async (opts) => {
      applyVerbose(opts);
      const { runBrowserDoctor, renderBrowserDoctorReport } = await import('./doctor.js');
      const report = await runBrowserDoctor({ live: opts.live, sessions: opts.sessions, cliVersion: PKG_VERSION });
      console.log(renderBrowserDoctorReport(report));
    });

  program
    .command('completion')
    .description('Output shell completion script')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .action((shell) => {
      printCompletionScript(shell);
    });

  // ── Plugin management ──────────────────────────────────────────────────────

  const pluginCmd = program.command('plugin').description('Manage opencli plugins');

  pluginCmd
    .command('install')
    .description('Install a plugin from a git repository')
    .argument('<source>', 'Plugin source (e.g. github:user/repo)')
    .action(async (source: string) => {
      const { installPlugin } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      try {
        const result = installPlugin(source);
        await discoverPlugins();
        if (Array.isArray(result)) {
          if (result.length === 0) {
            console.log(styleText('yellow', 'No plugins were installed (all skipped or incompatible).'));
          } else {
            console.log(styleText('green', `\u2705 Installed ${result.length} plugin(s) from monorepo: ${result.join(', ')}`));
          }
        } else {
          console.log(styleText('green', `\u2705 Plugin "${result}" installed successfully. Commands are ready to use.`));
        }
      } catch (err) {
        console.error(styleText('red', `Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
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
        console.log(styleText('green', `✅ Plugin "${name}" uninstalled.`));
      } catch (err) {
        console.error(styleText('red', `Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('update')
    .description('Update a plugin (or all plugins) to the latest version')
    .argument('[name]', 'Plugin name (required unless --all is passed)')
    .option('--all', 'Update all installed plugins')
    .action(async (name: string | undefined, opts: { all?: boolean }) => {
      if (!name && !opts.all) {
        console.error(styleText('red', 'Error: Please specify a plugin name or use the --all flag.'));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      if (name && opts.all) {
        console.error(styleText('red', 'Error: Cannot specify both a plugin name and --all.'));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const { updatePlugin, updateAllPlugins } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      if (opts.all) {
        const results = updateAllPlugins();
        if (results.length > 0) {
          await discoverPlugins();
        }

        let hasErrors = false;
        console.log(styleText('bold', '  Update Results:'));
        for (const result of results) {
          if (result.success) {
            console.log(`  ${styleText('green', '✓')} ${result.name}`);
            continue;
          }
          hasErrors = true;
          console.log(`  ${styleText('red', '✗')} ${result.name} — ${styleText('dim', String(result.error))}`);
        }

        if (results.length === 0) {
          console.log(styleText('dim', '  No plugins installed.'));
          return;
        }

        console.log();
        if (hasErrors) {
          console.error(styleText('red', 'Completed with some errors.'));
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        } else {
          console.log(styleText('green', '✅ All plugins updated successfully.'));
        }
        return;
      }

      try {
        updatePlugin(name!);
        await discoverPlugins();
        console.log(styleText('green', `✅ Plugin "${name}" updated successfully.`));
      } catch (err) {
        console.error(styleText('red', `Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });


  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('-f, --format <fmt>', 'Output format: yaml, json, table', 'yaml')
    .action(async (opts) => {
      const { listPlugins } = await import('./plugin.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log(styleText('dim', '  No plugins installed.'));
        console.log(styleText('dim', '  Install one with: opencli plugin install github:user/repo'));
        return;
      }
      if (opts.format !== 'table') {
        renderOutput(plugins, {
          fmt: opts.format,
          columns: ['name', 'commands', 'source'],
          title: 'opencli/plugins',
          source: 'opencli plugin list',
        });
        return;
      }
      console.log();
      console.log(styleText('bold', '  Installed plugins'));
      console.log();

      // Group by monorepo
      const standalone = plugins.filter((p) => !p.monorepoName);
      const monoGroups = new Map<string, typeof plugins>();
      for (const p of plugins) {
        if (!p.monorepoName) continue;
        const g = monoGroups.get(p.monorepoName) ?? [];
        g.push(p);
        monoGroups.set(p.monorepoName, g);
      }

      for (const p of standalone) {
        const version = p.version ? styleText('green', ` @${p.version}`) : '';
        const desc = p.description ? styleText('dim', ` — ${p.description}`) : '';
        const cmds = p.commands.length > 0 ? styleText('dim', ` (${p.commands.join(', ')})`) : '';
        const src = p.source ? styleText('dim', ` ← ${p.source}`) : '';
        console.log(`  ${styleText('cyan', p.name)}${version}${desc}${cmds}${src}`);
      }

      for (const [mono, group] of monoGroups) {
        console.log();
        console.log(styleText(['bold', 'magenta'], `  📦 ${mono}`) + styleText('dim', ' (monorepo)'));
        for (const p of group) {
          const version = p.version ? styleText('green', ` @${p.version}`) : '';
          const desc = p.description ? styleText('dim', ` — ${p.description}`) : '';
          const cmds = p.commands.length > 0 ? styleText('dim', ` (${p.commands.join(', ')})`) : '';
          console.log(`    ${styleText('cyan', p.name)}${version}${desc}${cmds}`);
        }
      }

      console.log();
      console.log(styleText('dim', `  ${plugins.length} plugin(s) installed`));
      console.log();
    });

  pluginCmd
    .command('create')
    .description('Create a new plugin scaffold')
    .argument('<name>', 'Plugin name (lowercase, hyphens allowed)')
    .option('-d, --dir <path>', 'Output directory (default: ./<name>)')
    .option('--description <text>', 'Plugin description')
    .action(async (name: string, opts: { dir?: string; description?: string }) => {
      const { createPluginScaffold } = await import('./plugin-scaffold.js');
      try {
        const result = createPluginScaffold(name, {
          dir: opts.dir,
          description: opts.description,
        });
        console.log(styleText('green', `✅ Plugin scaffold created at ${result.dir}`));
        console.log();
        console.log(styleText('bold', '  Files created:'));
        for (const f of result.files) {
          console.log(`    ${styleText('cyan', f)}`);
        }
        console.log();
        console.log(styleText('dim', '  Next steps:'));
        console.log(styleText('dim', `    cd ${result.dir}`));
        console.log(styleText('dim', `    opencli plugin install file://${result.dir}`));
        console.log(styleText('dim', `    opencli ${name} hello`));
      } catch (err) {
        console.error(styleText('red', `Error: ${getErrorMessage(err)}`));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Built-in: adapter management ─────────────────────────────────────────
  const adapterCmd = program.command('adapter').description('Manage CLI adapters');

  adapterCmd
    .command('status')
    .description('Show which sites have local overrides vs using official baseline')
    .action(async () => {
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');
      const builtinClisDir = BUILTIN_CLIS;
      try {
        const userEntries = await fs.promises.readdir(userClisDir, { withFileTypes: true });
        const userSites = userEntries.filter(e => e.isDirectory()).map(e => e.name).sort();
        let builtinSites: string[] = [];
        try {
          const builtinEntries = await fs.promises.readdir(builtinClisDir, { withFileTypes: true });
          builtinSites = builtinEntries.filter(e => e.isDirectory()).map(e => e.name).sort();
        } catch { /* no builtin dir */ }

        if (userSites.length === 0) {
          console.log('No local adapter overrides. All sites use the official baseline.');
          return;
        }

        console.log(`Local overrides in ~/.opencli/clis/ (${userSites.length} sites):\n`);
        for (const site of userSites) {
          const isOfficial = builtinSites.includes(site);
          const label = isOfficial ? 'override' : 'custom';
          console.log(`  ${site} [${label}]`);
        }
        console.log(`\nOfficial baseline: ${builtinSites.length} sites in package`);
      } catch {
        console.log('No local adapter overrides. All sites use the official baseline.');
      }
    });

  adapterCmd
    .command('eject')
    .description('Copy an official adapter to ~/.opencli/clis/ for local editing')
    .argument('<site>', 'Site name (e.g. twitter, bilibili)')
    .action(async (site: string) => {
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');
      const builtinSiteDir = path.join(BUILTIN_CLIS, site);
      const userSiteDir = path.join(userClisDir, site);

      try {
        await fs.promises.access(builtinSiteDir);
      } catch {
        console.error(styleText('red', `Error: Site "${site}" not found in official adapters.`));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      try {
        await fs.promises.access(userSiteDir);
        console.error(styleText('yellow', `Site "${site}" already exists in ~/.opencli/clis/. Use "opencli adapter reset ${site}" first to restore official version.`));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      } catch { /* good, doesn't exist yet */ }

      fs.cpSync(builtinSiteDir, userSiteDir, { recursive: true });
      console.log(styleText('green', `✅ Ejected "${site}" to ~/.opencli/clis/${site}/`));
      console.log('You can now edit the adapter files. Changes take effect immediately.');
      console.log(styleText('yellow', 'Note: Official updates to this adapter will overwrite your changes.'));
    });

  adapterCmd
    .command('reset')
    .description('Remove local override and restore official adapter version')
    .argument('[site]', 'Site name (e.g. twitter, bilibili)')
    .option('--all', 'Reset all local overrides')
    .action(async (site: string | undefined, opts: { all?: boolean }) => {
      const os = await import('node:os');
      const userClisDir = path.join(os.homedir(), '.opencli', 'clis');

      if (opts.all) {
        try {
          const userEntries = await fs.promises.readdir(userClisDir, { withFileTypes: true });
          const dirs = userEntries.filter(e => e.isDirectory());
          if (dirs.length === 0) {
            console.log('No local sites to reset.');
            return;
          }
          for (const dir of dirs) {
            fs.rmSync(path.join(userClisDir, dir.name), { recursive: true, force: true });
          }
          console.log(styleText('green', `✅ Reset ${dirs.length} site(s). All adapters now use official baseline.`));
        } catch {
          console.log('No local sites to reset.');
        }
        return;
      }

      if (!site) {
        console.error(styleText('red', 'Error: Please specify a site name or use --all.'));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const userSiteDir = path.join(userClisDir, site);
      try {
        await fs.promises.access(userSiteDir);
      } catch {
        console.error(styleText('yellow', `Site "${site}" has no local override.`));
        return;
      }

      const isOfficial = fs.existsSync(path.join(BUILTIN_CLIS, site));
      fs.rmSync(userSiteDir, { recursive: true, force: true });
      console.log(styleText('green', isOfficial
        ? `✅ Reset "${site}". Now using official baseline.`
        : `✅ Removed custom site "${site}".`));
    });

  // ── Built-in: daemon ──────────────────────────────────────────────────────
  const daemonCmd = program.command('daemon').description('Manage the opencli daemon');
  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => { await daemonStatus(); });
  daemonCmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => { await daemonStop(); });

  // ── External CLIs ─────────────────────────────────────────────────────────

  const externalClis = loadExternalClis();

  program
    .command('install')
    .description('Install an external CLI')
    .argument('<name>', 'Name of the external CLI')
    .action((name: string) => {
      const ext = externalClis.find(e => e.name === name);
      if (!ext) {
        console.error(styleText('red', `External CLI '${name}' not found in registry.`));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
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
    } catch (err) {
      console.error(styleText('red', `Error: ${getErrorMessage(err)}`));
      process.exitCode = EXIT_CODES.GENERIC_ERROR;
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
    .option('--timeout <seconds>', 'Maximum time to wait for a reply (default: 120s)')
    .action(async (opts) => {
      // @ts-expect-error JS adapter — no type declarations
      const { startServe } = await import('../clis/antigravity/serve.js');
      await startServe({
        port: parseInt(opts.port, 10),
        timeout: opts.timeout ? parsePositiveIntOption(opts.timeout, '--timeout', 120) : undefined,
      });
    });

  // ── Dynamic adapter commands ──────────────────────────────────────────────

  const siteGroups = new Map<string, Command>();
  siteGroups.set('antigravity', antigravityCmd);
  registerAllCommands(program, siteGroups);

  // ── Unknown command fallback ──────────────────────────────────────────────
  // Security: do NOT auto-discover and register arbitrary system binaries.
  // Only explicitly registered external CLIs (via `opencli register`) are allowed.

  program.on('command:*', (operands: string[]) => {
    const binary = operands[0];
    console.error(styleText('red', `error: unknown command '${binary}'`));
    if (isBinaryInstalled(binary)) {
      console.error(styleText('dim', `  Tip: '${binary}' exists on your PATH. Use 'opencli register ${binary}' to add it as an external CLI.`));
    }
    program.outputHelp();
    process.exitCode = EXIT_CODES.USAGE_ERROR;
  });

  return program;
}

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  createProgram(BUILTIN_CLIS, USER_CLIS).parse();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface BrowserVerifyInvocation {
  binary: string;
  args: string[];
  cwd: string;
  shell?: boolean;
}

export { findPackageRoot };

export function resolveBrowserVerifyInvocation(opts: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
} = {}): BrowserVerifyInvocation {
  const platform = opts.platform ?? process.platform;
  const fileExists = opts.fileExists ?? fs.existsSync;
  const readFile = opts.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));
  const projectRoot = opts.projectRoot ?? findPackageRoot(CLI_FILE, fileExists);

  for (const builtEntry of getBuiltEntryCandidates(projectRoot, readFile)) {
    if (fileExists(builtEntry)) {
      return {
        binary: process.execPath,
        args: [builtEntry],
        cwd: projectRoot,
      };
    }
  }

  const sourceEntry = path.join(projectRoot, 'src', 'main.ts');
  if (!fileExists(sourceEntry)) {
    throw new Error(`Could not find opencli entrypoint under ${projectRoot}. Expected built entry from package.json or src/main.ts.`);
  }

  const localTsxBin = path.join(projectRoot, 'node_modules', '.bin', platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (fileExists(localTsxBin)) {
    return {
      binary: localTsxBin,
      args: [sourceEntry],
      cwd: projectRoot,
      ...(platform === 'win32' ? { shell: true } : {}),
    };
  }

  return {
    binary: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['tsx', sourceEntry],
    cwd: projectRoot,
    ...(platform === 'win32' ? { shell: true } : {}),
  };
}

/** Infer a workspace-friendly hostname from a URL, with site override. */
function inferHost(url: string, site?: string): string {
  if (site) return site;
  try { return new URL(url).host; } catch { return 'default'; }
}
