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
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { loadExternalClis, executeExternalCli, installExternalCli, registerExternalCli, isBinaryInstalled } from './external.js';
import { registerAllCommands } from './commanderAdapter.js';
import { EXIT_CODES, getErrorMessage, BrowserConnectError } from './errors.js';
import { TargetError, type TargetErrorCode } from './browser/target-errors.js';
import { resolveTargetJs, getTextResolvedJs, getValueResolvedJs, getAttributesResolvedJs, selectResolvedJs, isAutocompleteResolvedJs, clickResolvedJs, type ResolveOptions, type TargetMatchLevel } from './browser/target-resolver.js';
import { buildFindJs, isFindError, type FindResult, type FindError } from './browser/find.js';
import { inferShape } from './browser/shape.js';
import { assignKeys } from './browser/network-key.js';
import { DEFAULT_TTL_MS, findEntry, loadNetworkCache, saveNetworkCache, type CachedNetworkEntry } from './browser/network-cache.js';
import { parseFilter, shapeMatchesFilter } from './browser/shape-filter.js';
import { buildHtmlTreeJs, type HtmlTreeResult } from './browser/html-tree.js';
import { buildExtractHtmlJs, runExtractFromHtml } from './browser/extract.js';
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
  /** Full body size in chars before any capture-layer truncation. */
  bodyFullSize?: number;
  /** True when the capture layer had to cap the stored body to protect memory. */
  bodyTruncated?: boolean;
};

/**
 * Normalize raw capture entries (from daemon/CDP `readNetworkCapture` or
 * the JS interceptor's `window.__opencli_net`) into a consistent shape.
 * Response preview is parsed as JSON when possible, otherwise kept as string.
 * `bodyFullSize` / `bodyTruncated` surface capture-layer truncation so the
 * agent-facing envelope can warn when the body isn't whole.
 */
async function captureNetworkItems(page: import('./types.js').IPage): Promise<BrowserNetworkItem[]> {
  if (page.readNetworkCapture) {
    const raw = await page.readNetworkCapture();
    return (raw as Array<Record<string, unknown>>).map((e) => {
      const preview = (e.responsePreview as string) ?? null;
      let body: unknown = null;
      if (preview) {
        try { body = JSON.parse(preview); } catch { body = preview; }
      }
      const fullSize = typeof e.responseBodyFullSize === 'number'
        ? (e.responseBodyFullSize as number)
        : (preview ? preview.length : 0);
      const truncated = e.responseBodyTruncated === true;
      return {
        url: (e.url as string) || '',
        method: (e.method as string) || 'GET',
        status: (e.responseStatus as number) || 0,
        size: fullSize,
        ct: (e.responseContentType as string) || '',
        body,
        bodyFullSize: fullSize,
        bodyTruncated: truncated,
      };
    });
  }
  const raw = await page.evaluate(`(function(){ return JSON.stringify(window.__opencli_net || []); })()`) as string;
  try { return JSON.parse(raw) as BrowserNetworkItem[]; } catch { return []; }
}

/** Drop static-resource / telemetry noise so agents see only API-shaped traffic. */
function filterNetworkItems(items: BrowserNetworkItem[]): BrowserNetworkItem[] {
  return items.filter((r) =>
    (r.ct?.includes('json') || r.ct?.includes('xml') || r.ct?.includes('text/plain')) &&
    !/\.(js|css|png|jpg|gif|svg|woff|ico|map)(\?|$)/i.test(r.url) &&
    !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url),
  );
}

/** Emit a structured error JSON so agents can branch on `error.code` without regex. */
function emitNetworkError(code: string, message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ error: { code, message, ...extra } }, null, 2));
  process.exitCode = EXIT_CODES.USAGE_ERROR;
}

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
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .option('--json', 'JSON output (deprecated)')
    .action((opts) => {
      const registry = getRegistry();
      const commands = [...new Set(registry.values())].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      const fmt = opts.json && opts.format === 'table' ? 'json' : opts.format;
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

  // ── Built-in: browser (browser control for Claude Code skill) ───────────────
  //
  // Make websites accessible for AI agents.
  // All commands wrapped in browserAction() for consistent error handling.

  const browser = program
    .command('browser')
    .description('Browser control — navigate, click, type, extract, wait (no LLM needed)');

  /**
   * Resolve a `<target>` (numeric ref or CSS selector) via the unified resolver.
   * Returns the CSS match count so callers can propagate `matches_n` into the
   * JSON envelope printed back to the agent.
   */
  async function resolveRef(
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    ref: string,
    opts: ResolveOptions = {},
  ): Promise<{ matches_n: number; match_level: TargetMatchLevel }> {
    const resolution = await page.evaluate(resolveTargetJs(ref, opts)) as
      | { ok: true; matches_n: number; match_level: TargetMatchLevel }
      | { ok: false; code: TargetErrorCode; message: string; hint: string; candidates?: string[]; matches_n?: number };
    if (!resolution.ok) {
      throw new TargetError({
        code: resolution.code,
        message: resolution.message,
        hint: resolution.hint,
        candidates: resolution.candidates,
        matches_n: resolution.matches_n,
      });
    }
    return { matches_n: resolution.matches_n, match_level: resolution.match_level };
  }

  /**
   * Parse `--nth <n>` flag, returning the parsed 0-based index or a usage error.
   * The surface mirrors `--depth` etc. in `browser get html --as json`: the flag
   * is optional, must be a non-negative integer when present, and on failure we
   * emit the structured error envelope rather than throwing past the command.
   */
  function parseNthFlag(raw: unknown): number | null | { error: string } {
    if (raw === undefined || raw === null || raw === '') return null;
    const str = String(raw);
    if (!/^\d+$/.test(str)) {
      return { error: `--nth must be a non-negative integer, got "${str}"` };
    }
    return Number.parseInt(str, 10);
  }

  /** Emit the `{ error: { code, message, hint?, candidates?, matches_n? } }` envelope used by the selector-first commands. */
  function emitTargetError(err: TargetError): void {
    console.log(JSON.stringify({
      error: {
        code: err.code,
        message: err.message,
        hint: err.hint,
        ...(err.candidates && { candidates: err.candidates }),
        ...(err.matches_n !== undefined && { matches_n: err.matches_n }),
      },
    }, null, 2));
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
          // Agent-facing structured envelope on stdout + short human line on stderr.
          emitTargetError(err);
          log.error(`[${err.code}] ${err.message}`);
          if (err.hint) log.error(`Hint: ${err.hint}`);
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

  /**
   * Network interceptor JS — injected on every open/navigate to capture
   * fetch/XHR bodies when the session-level capture channel (CDP/extension)
   * isn't available. Keeps parity with the CDP path's truncation contract:
   * when a body exceeds the per-entry cap, we keep a string prefix and set
   * `bodyTruncated: true` + `bodyFullSize: <original length>` so `browser
   * network` can propagate a visible signal to the agent instead of
   * silently dropping the body. Per-entry cap is 1 MiB and the ring is
   * capped at 200 entries, bounding worst-case in-page memory.
   */
  const NETWORK_INTERCEPTOR_JS = `(function(){if(window.__opencli_net)return;window.__opencli_net=[];var M=200,B=1048576,F=window.fetch;function capture(url,method,status,text,ct){if(window.__opencli_net.length>=M)return;var full=text?text.length:0,trunc=full>B,stored=trunc?text.slice(0,B):text,body=null;if(stored){if(trunc){body=stored}else{try{body=JSON.parse(stored)}catch(e){body=stored}}}var e={url:url,method:method||'GET',status:status,size:full,ct:ct,body:body};if(trunc){e.bodyTruncated=true;e.bodyFullSize=full}window.__opencli_net.push(e)}window.fetch=async function(){var r=await F.apply(this,arguments);try{var ct=r.headers.get('content-type')||'';if(ct.includes('json')||ct.includes('text')){var c=r.clone(),t=await c.text();capture(r.url||(arguments[0]&&arguments[0].url)||String(arguments[0]),(arguments[1]&&arguments[1].method)||'GET',r.status,t,ct)}}catch(e){}return r};var X=XMLHttpRequest.prototype,O=X.open,S=X.send;X.open=function(m,u){this._om=m;this._ou=u;return O.apply(this,arguments)};X.send=function(){var x=this;x.addEventListener('load',function(){try{var ct=x.getResponseHeader('content-type')||'';if(ct.includes('json')||ct.includes('text')){capture(x._ou,x._om||'GET',x.status,x.responseText||'',ct)}}catch(e){}});return S.apply(this,arguments)}})()`;

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

  // ── Find (structured CSS query, agent-native) ──
  //
  // `browser find --css <sel>` lets agents jump straight from a semantic
  // selector to a JSON list of matching elements, without having to parse
  // the free-text state snapshot to recover indices.
  addBrowserTabOption(
    browser.command('find')
      .option('--css <selector>', 'CSS selector (required)')
      .option('--limit <n>', 'Max entries returned', '50')
      .option('--text-max <n>', 'Max chars of trimmed text per entry', '120')
      .description('Find DOM elements by CSS selector — returns JSON {matches_n, entries[]}'),
  )
    .action(browserAction(async (page, opts) => {
      if (!opts.css || typeof opts.css !== 'string') {
        console.log(JSON.stringify({
          error: {
            code: 'usage_error',
            message: '--css <selector> is required',
            hint: 'Example: opencli browser find --css ".btn.primary"',
          },
        }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const limit = parseNthFlag(opts.limit);
      if (limit && typeof limit === 'object' && 'error' in limit) {
        console.log(JSON.stringify({ error: { code: 'usage_error', message: limit.error.replace('--nth', '--limit') } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const textMax = parseNthFlag(opts.textMax);
      if (textMax && typeof textMax === 'object' && 'error' in textMax) {
        console.log(JSON.stringify({ error: { code: 'usage_error', message: textMax.error.replace('--nth', '--text-max') } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const result = await page.evaluate(buildFindJs(opts.css, {
        limit: limit as number | null ?? undefined,
        textMax: textMax as number | null ?? undefined,
      })) as FindResult | FindError;
      if (isFindError(result)) {
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
        return;
      }
      console.log(JSON.stringify(result, null, 2));
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

  // Read commands (`get text/value/attributes`) always emit a JSON envelope:
  //
  //   { value, matches_n }                           — success
  //   { error: { code, message, hint, matches_n? } } — structured failure
  //
  // `<target>` accepts either a numeric ref (from `browser state`/`browser find`)
  // or a CSS selector. On multi-match CSS, the first element wins and the real
  // match count is exposed via `matches_n`; `--nth <n>` picks a specific one.
  const runGetCommand = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    target: string,
    opts: { nth?: string },
    evalJs: string,
    field: 'text' | 'value' | 'attributes',
  ): Promise<void> => {
    const nth = parseNthFlag(opts.nth);
    if (nth && typeof nth === 'object' && 'error' in nth) {
      console.log(JSON.stringify({ error: { code: 'usage_error', message: nth.error } }, null, 2));
      process.exitCode = EXIT_CODES.USAGE_ERROR;
      return;
    }
    const { matches_n, match_level } = await resolveRef(page, String(target), {
      firstOnMulti: nth === null,
      ...(typeof nth === 'number' ? { nth } : {}),
    });
    const raw = await page.evaluate(evalJs);
    let value: unknown;
    if (field === 'attributes') {
      // getAttributesResolvedJs stringifies the attribute record — parse it back so
      // the JSON envelope contains a real object rather than a nested JSON string.
      try { value = raw == null ? {} : JSON.parse(String(raw)); }
      catch { value = raw; }
    } else {
      value = raw ?? null;
    }
    console.log(JSON.stringify({ value, matches_n, match_level }, null, 2));
  };

  addBrowserTabOption(
    get.command('text')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Element text content — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, String(target), opts ?? {}, getTextResolvedJs(), 'text')));

  addBrowserTabOption(
    get.command('value')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Input/textarea value — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, String(target), opts ?? {}, getValueResolvedJs(), 'value')));

  addBrowserTabOption(
    get.command('html')
      .option('--selector <css>', 'CSS selector scope (first match)')
      .option('--as <format>', 'Output format: "html" (default) or "json" for structured tree', 'html')
      .option('--max <n>', 'Max characters of raw HTML to return (0 = unlimited)', '0')
      .option('--depth <n>', '(--as json) Max tree depth below root (0 = root only, 0 disables = unlimited via empty)', '')
      .option('--children-max <n>', '(--as json) Max element children kept per node (empty = unlimited)', '')
      .option('--text-max <n>', '(--as json) Max chars of direct text kept per node (empty = unlimited)', '')
      .description('Page HTML (or scoped); use --as json for a {tag, attrs, text, children} tree'),
  )
    .action(browserAction(async (page, opts) => {
      const format = String(opts.as || 'html').toLowerCase();
      if (format !== 'html' && format !== 'json') {
        console.log(JSON.stringify({ error: { code: 'invalid_format', message: `--as must be "html" or "json", got "${opts.as}"` } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      // `--max` is validated up-front (before touching the page) so a bad value
      // gets the same structured error regardless of selector/format path.
      const rawMax = String(opts.max ?? '0');
      if (!/^\d+$/.test(rawMax)) {
        console.log(JSON.stringify({ error: { code: 'invalid_max', message: `--max must be a non-negative integer, got "${opts.max}"` } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const max = Number.parseInt(rawMax, 10);

      if (format === 'json') {
        const parseBudget = (flag: string, value: unknown): number | null | { error: string } => {
          const raw = value === undefined || value === null ? '' : String(value);
          if (raw === '') return null;
          if (!/^\d+$/.test(raw)) return { error: `${flag} must be a non-negative integer, got "${raw}"` };
          return Number.parseInt(raw, 10);
        };
        const depth = parseBudget('--depth', opts.depth);
        const childrenMax = parseBudget('--children-max', opts.childrenMax);
        const textMax = parseBudget('--text-max', opts.textMax);
        for (const budget of [depth, childrenMax, textMax]) {
          if (budget && typeof budget === 'object' && 'error' in budget) {
            console.log(JSON.stringify({ error: { code: 'invalid_budget', message: budget.error } }, null, 2));
            process.exitCode = EXIT_CODES.USAGE_ERROR;
            return;
          }
        }
        const js = buildHtmlTreeJs({
          selector: opts.selector ?? null,
          depth: depth as number | null,
          childrenMax: childrenMax as number | null,
          textMax: textMax as number | null,
        });
        const result = await page.evaluate(js) as HtmlTreeResult | { selector: string; invalidSelector: true; reason: string } | null;
        if (result && typeof result === 'object' && 'invalidSelector' in result && result.invalidSelector) {
          console.log(JSON.stringify({
            error: { code: 'invalid_selector', message: `Selector "${opts.selector}" is not a valid CSS selector: ${result.reason}` },
          }, null, 2));
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        const ok = result as HtmlTreeResult | null;
        if (!ok || ok.matched === 0) {
          console.log(JSON.stringify({
            error: {
              code: 'selector_not_found',
              message: opts.selector
                ? `Selector "${opts.selector}" matched 0 elements.`
                : 'Page has no documentElement.',
            },
          }, null, 2));
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        console.log(JSON.stringify(ok, null, 2));
        return;
      }

      // Raw HTML path — unbounded by default; --max optionally caps with a visible marker.
      // Selector lookup is wrapped in try/catch inside page context so an invalid
      // selector returns a structured signal instead of throwing through page.evaluate.
      const sel = opts.selector ? JSON.stringify(opts.selector) : 'null';
      const rawResult = await page.evaluate(
        `(() => {
          const s = ${sel};
          if (s) {
            try {
              const el = document.querySelector(s);
              return { kind: 'ok', html: el ? el.outerHTML : null };
            } catch (e) {
              return { kind: 'invalid_selector', reason: (e && e.message) || String(e) };
            }
          }
          return { kind: 'ok', html: document.documentElement ? document.documentElement.outerHTML : null };
        })()`,
      ) as { kind: 'ok'; html: string | null } | { kind: 'invalid_selector'; reason: string };

      if (rawResult.kind === 'invalid_selector') {
        console.log(JSON.stringify({
          error: { code: 'invalid_selector', message: `Selector "${opts.selector}" is not a valid CSS selector: ${rawResult.reason}` },
        }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const html = rawResult.html;

      if (html === null) {
        if (opts.selector) {
          console.log(JSON.stringify({
            error: { code: 'selector_not_found', message: `Selector "${opts.selector}" matched 0 elements.` },
          }, null, 2));
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        console.log('(empty)');
        return;
      }
      if (max > 0 && html.length > max) {
        console.log(`<!-- opencli: truncated ${max} of ${html.length} chars; re-run without --max (or --max 0) for full -->\n${html.slice(0, max)}`);
        return;
      }
      console.log(html);
    }));

  addBrowserTabOption(
    get.command('attributes')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Element attributes — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, String(target), opts ?? {}, getAttributesResolvedJs(), 'attributes')));

  // ── Interact ──
  //
  // Write commands (`click/type/select`) share the same `<target>` contract
  // as the read commands but *reject* multi-match CSS as `selector_ambiguous`
  // unless the caller passes `--nth <n>`. That asymmetry is intentional:
  // clicking "one of three buttons" at random is almost never what the agent
  // meant. Every branch emits a JSON envelope on stdout; error envelopes go
  // through the unified TargetError handler in browserAction.

  /**
   * Parse the `--nth` flag and convert it to `ResolveOptions`.
   * Returns `{ error }` when the flag was malformed (so the command can
   * print the structured usage error and exit) or `{ opts }` to feed
   * into resolveRef / page.click / page.typeText.
   */
  function nthToResolveOpts(raw: unknown): { error: string } | { opts: ResolveOptions } {
    const parsed = parseNthFlag(raw);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed;
    if (typeof parsed === 'number') return { opts: { nth: parsed } };
    return { opts: {} };
  }

  addBrowserTabOption(
    browser.command('click')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Click element — JSON envelope {clicked, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        console.log(JSON.stringify({ error: { code: 'usage_error', message: parsed.error } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const { matches_n, match_level } = await page.click(String(target), parsed.opts);
      console.log(JSON.stringify({ clicked: true, target: String(target), matches_n, match_level }, null, 2));
    }));

  addBrowserTabOption(
    browser.command('type')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector')
      .argument('<text>', 'Text to type')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Click element, then type text — JSON envelope {typed, text, target, matches_n, autocomplete}'),
  )
    .action(browserAction(async (page, target, text, opts) => {
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        console.log(JSON.stringify({ error: { code: 'usage_error', message: parsed.error } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      // Click first (focuses the field), wait briefly, then type.
      await page.click(String(target), parsed.opts);
      await page.wait(0.3);
      const { matches_n, match_level } = await page.typeText(String(target), String(text), parsed.opts);
      // __resolved is already set by the resolver call inside page.typeText
      const isAutocomplete = await page.evaluate(isAutocompleteResolvedJs()) as boolean;
      if (isAutocomplete) await page.wait(0.4);
      console.log(JSON.stringify({
        typed: true,
        text: String(text),
        target: String(target),
        matches_n,
        match_level,
        autocomplete: !!isAutocomplete,
      }, null, 2));
    }));

  addBrowserTabOption(
    browser.command('select')
      .argument('<target>', 'Numeric ref (from browser state / find) or CSS selector of a <select> element')
      .argument('<option>', 'Option text (or value) to select')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Select dropdown option — JSON envelope {selected, target, matches_n}'),
  )
    .action(browserAction(async (page, target, option, opts) => {
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        console.log(JSON.stringify({ error: { code: 'usage_error', message: parsed.error } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const { matches_n, match_level } = await resolveRef(page, String(target), parsed.opts);
      const result = await page.evaluate(selectResolvedJs(String(option))) as
        | { error?: string; selected?: string; available?: string[] }
        | null;
      if (result?.error) {
        // The select-specific "Not a <select>" / "Option not found" errors
        // are domain-level failures — emit a structured envelope so agents
        // can branch on code rather than scrape a log line.
        console.log(JSON.stringify({
          error: {
            code: result.error === 'Not a <select>' ? 'not_a_select' : 'option_not_found',
            message: result.error,
            ...(result.available && { available: result.available }),
            matches_n,
          },
        }, null, 2));
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
        return;
      }
      console.log(JSON.stringify({
        selected: result?.selected ?? String(option),
        target: String(target),
        matches_n,
        match_level,
      }, null, 2));
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

  // ── Extract (content reading) ──
  //
  // `extract` answers the "read this page" question that `get html` / `get text`
  // can't: denoise → markdown → paragraph-aware chunking. Agents walk long pages
  // by passing back the `next_start_char` cursor instead of juggling selectors.

  addBrowserTabOption(
    browser.command('extract')
      .option('--selector <css>', 'CSS selector scope; defaults to <main>/<article>/<body>')
      .option('--chunk-size <chars>', 'Target chunk size in chars', '20000')
      .option('--start <char>', 'Start offset (use next_start_char from a previous extract)', '0')
      .description('Extract page content as markdown, paragraph-aware chunks for long pages'),
  )
    .action(browserAction(async (page, opts) => {
      const rawChunk = String(opts.chunkSize ?? '20000');
      if (!/^\d+$/.test(rawChunk) || Number.parseInt(rawChunk, 10) <= 0) {
        console.log(JSON.stringify({ error: { code: 'invalid_chunk_size', message: `--chunk-size must be a positive integer, got "${opts.chunkSize}"` } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const rawStart = String(opts.start ?? '0');
      if (!/^\d+$/.test(rawStart)) {
        console.log(JSON.stringify({ error: { code: 'invalid_start', message: `--start must be a non-negative integer, got "${opts.start}"` } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      const chunkSize = Number.parseInt(rawChunk, 10);
      const start = Number.parseInt(rawStart, 10);
      const selector = typeof opts.selector === 'string' && opts.selector.length > 0 ? opts.selector : null;

      const js = buildExtractHtmlJs(selector);
      const res = await page.evaluate(js) as
        | { ok: true; url: string; title: string; html: string }
        | { invalidSelector: true; reason: string }
        | { notFound: true }
        | null;

      if (!res) {
        console.log(JSON.stringify({ error: { code: 'extract_failed', message: 'Page returned no root element.' } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      if ('invalidSelector' in res) {
        console.log(JSON.stringify({ error: { code: 'invalid_selector', message: `Selector "${selector}" is not a valid CSS selector: ${res.reason}` } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      if ('notFound' in res) {
        console.log(JSON.stringify({ error: { code: 'selector_not_found', message: selector ? `Selector "${selector}" matched 0 elements.` : 'Page has no body/main/article element.' } }, null, 2));
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const envelope = runExtractFromHtml({
        html: res.html,
        url: res.url,
        title: res.title,
        selector,
        start,
        chunkSize,
      });
      console.log(JSON.stringify(envelope, null, 2));
    }));

  // ── Network (API discovery) ──
  //
  // Default output is JSON (agent-native). Each entry carries a stable `key`
  // (GraphQL operationName or `METHOD host+pathname`) so agents can fetch
  // full bodies with `--detail <key>` even after subsequent commands.
  // Captures are persisted per workspace under ~/.opencli/cache/browser-network/.

  addBrowserTabOption(browser.command('network'))
    .option('--detail <key>', 'Emit full body for the entry with this key')
    .option('--all', 'Include static resources (js/css/images/telemetry)')
    .option('--raw', 'Emit full bodies for every entry (skip shape preview)')
    .option('--filter <fields>', 'Comma-separated field names; keep only entries whose body shape has ALL names as path segments')
    .option('--max-body <chars>', 'With --detail: cap the emitted body at N chars (0 = unlimited, default)', '0')
    .option('--ttl <ms>', 'Cache TTL in ms for --detail lookups', String(DEFAULT_TTL_MS))
    .description('Capture network requests as shape previews; retrieve full bodies by key')
    .action(browserAction(async (page, opts) => {
      const ttlMs = parsePositiveIntOption(opts.ttl, 'ttl', DEFAULT_TTL_MS);
      const workspace = DEFAULT_BROWSER_WORKSPACE;
      const hasDetail = typeof opts.detail === 'string' && opts.detail.length > 0;
      const hasFilter = typeof opts.filter === 'string';

      // --detail and --filter do different things (one request by key vs. narrow
      // the list by shape), don't compose, and combining them has no sensible
      // semantic. Reject up front with a structured error instead of silently
      // dropping one.
      if (hasDetail && hasFilter) {
        emitNetworkError('invalid_args', '--filter and --detail cannot be used together (one narrows a list, the other fetches a specific entry).');
        return;
      }

      let filterFields: string[] | null = null;
      if (hasFilter) {
        const parsed = parseFilter(opts.filter as string);
        if ('reason' in parsed) {
          emitNetworkError('invalid_filter', parsed.reason);
          return;
        }
        filterFields = parsed.fields;
      }

      // --detail short-circuits: read from cache only, no live capture needed.
      if (hasDetail) {
        const res = loadNetworkCache(workspace, { ttlMs });
        if (res.status === 'missing') {
          emitNetworkError('cache_missing', `No cached capture. Run "browser network" first (in workspace "${workspace}").`);
          return;
        }
        if (res.status === 'expired') {
          emitNetworkError('cache_expired', `Cache is stale (age ${res.ageMs}ms > ttl ${ttlMs}ms). Re-run "browser network" to refresh.`);
          return;
        }
        if (res.status === 'corrupt' || !res.file) {
          emitNetworkError('cache_corrupt', 'Cache file is malformed; re-run "browser network" to regenerate.');
          return;
        }
        const entry = findEntry(res.file, opts.detail);
        if (!entry) {
          emitNetworkError('key_not_found', `Key "${opts.detail}" not in cache.`, {
            available_keys: res.file.entries.map((e) => e.key),
          });
          return;
        }
        const rawMaxBody = String(opts.maxBody ?? '0');
        if (!/^\d+$/.test(rawMaxBody)) {
          emitNetworkError('invalid_max_body', `--max-body must be a non-negative integer, got "${opts.maxBody}"`);
          return;
        }
        const maxBody = Number.parseInt(rawMaxBody, 10);

        // Body shape/source:
        // - If capture already truncated it (entry.body_truncated), the body is a string.
        // - If the adapter stored a JSON value, it parsed cleanly at capture time; leave it.
        // - --max-body applies a transport-level cap when the caller wants to keep output small.
        let outputBody: unknown = entry.body;
        let transportTruncated = false;
        if (maxBody > 0 && typeof entry.body === 'string' && entry.body.length > maxBody) {
          outputBody = entry.body.slice(0, maxBody);
          transportTruncated = true;
        }
        const captureTruncated = entry.body_truncated === true;

        const detailEnvelope: Record<string, unknown> = {
          key: entry.key,
          url: entry.url,
          method: entry.method,
          status: entry.status,
          ct: entry.ct,
          size: entry.size,
          shape: inferShape(entry.body),
          body: outputBody,
        };
        if (captureTruncated || transportTruncated) {
          detailEnvelope.body_truncated = true;
          detailEnvelope.body_full_size = entry.body_full_size ?? entry.size;
          detailEnvelope.body_truncation_reason = captureTruncated
            ? 'capture-limit'
            : 'max-body';
        }
        console.log(JSON.stringify(detailEnvelope, null, 2));
        return;
      }

      // Fresh capture path.
      let rawItems: BrowserNetworkItem[];
      try {
        rawItems = await captureNetworkItems(page);
      } catch (err) {
        emitNetworkError('capture_failed', `Could not read network capture: ${(err as Error).message}`);
        return;
      }

      const items = opts.all ? rawItems : filterNetworkItems(rawItems);
      const filteredOut = rawItems.length - items.length;

      const keyed = assignKeys(items);
      const cacheEntries: CachedNetworkEntry[] = keyed.map((it) => ({
        key: it.key,
        url: it.url,
        method: it.method,
        status: it.status,
        size: it.size,
        ct: it.ct,
        body: it.body,
        ...(it.bodyTruncated ? { body_truncated: true } : {}),
        ...(it.bodyTruncated && typeof it.bodyFullSize === 'number'
          ? { body_full_size: it.bodyFullSize }
          : {}),
      }));
      // Soft failure: the caller already has the data, so surface a warning
      // via the output envelope rather than erroring out the whole command.
      let cacheWarning: string | null = null;
      try {
        saveNetworkCache(workspace, cacheEntries);
      } catch (err) {
        cacheWarning = `Could not persist capture cache: ${(err as Error).message}. --detail lookups may miss this capture.`;
      }

      // Pair each cache entry with its shape up front so --filter can read
      // segments without recomputing, and the --raw view can keep the full
      // body. Cache persistence above stored the unfiltered set on purpose:
      // later `--detail <key>` lookups must still see requests that the
      // current --filter narrowed out.
      const shaped = cacheEntries.map((e) => ({ entry: e, shape: inferShape(e.body) }));
      const visible = filterFields
        ? shaped.filter((s) => shapeMatchesFilter(s.shape, filterFields))
        : shaped;
      const filterDropped = filterFields ? shaped.length - visible.length : 0;

      const envelope: Record<string, unknown> = {
        workspace,
        captured_at: new Date().toISOString(),
        count: visible.length,
        filtered_out: filteredOut,
      };
      if (filterFields) {
        envelope.filter = filterFields;
        envelope.filter_dropped = filterDropped;
      }
      if (cacheWarning) envelope.cache_warning = cacheWarning;

      const truncatedCount = visible.filter((s) => s.entry.body_truncated).length;
      if (truncatedCount > 0) {
        envelope.body_truncated_count = truncatedCount;
        envelope.body_truncated_hint = 'Some bodies exceeded the capture limit; their `shape` reflects only the captured prefix.';
      }

      if (opts.raw) {
        envelope.entries = visible.map((s) => s.entry);
      } else {
        envelope.entries = visible.map((s) => ({
          key: s.entry.key,
          method: s.entry.method,
          status: s.entry.status,
          url: s.entry.url,
          ct: s.entry.ct,
          size: s.entry.size,
          shape: s.shape,
          ...(s.entry.body_truncated ? { body_truncated: true } : {}),
        }));
        envelope.detail_hint = 'Run "browser network --detail <key>" for full body.';
      }
      console.log(JSON.stringify(envelope, null, 2));
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
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts) => {
      const { listPlugins } = await import('./plugin.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log(styleText('dim', '  No plugins installed.'));
        console.log(styleText('dim', '  Install one with: opencli plugin install github:user/repo'));
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

