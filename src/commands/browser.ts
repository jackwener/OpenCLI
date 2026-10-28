import { Command, InvalidArgumentError } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_BROWSER_CONNECT_TIMEOUT } from '../browser/config.js';
import { bindTab, BrowserCommandError, sendCommand } from '../browser/daemon-client.js';
import { buildExtractHtmlJs, runExtractFromHtml } from '../browser/extract.js';
import { buildFindJs, buildSemanticFindJs, isFindError, type FindError, type FindResult, type SemanticFindOptions } from '../browser/find.js';
import { buildHtmlTreeJs, type HtmlTreeResult } from '../browser/html-tree.js';
import { DEFAULT_TTL_MS, findEntry, loadNetworkCache, saveNetworkCache, type CachedNetworkEntry } from '../browser/network-cache.js';
import { NETWORK_INTERCEPTOR_JS } from '../browser/network-interceptor.js';
import { assignKeys } from '../browser/network-key.js';
import { sanitizeCapturedRequest, sanitizeCapturedUrl, type SafeNetworkRequest } from '../browser/network-request.js';
import { profileRouteParams, resolveProfileSelection, type ProfileSelection } from '../browser/profile.js';
import { parseFilter, shapeMatchesFilter } from '../browser/shape-filter.js';
import { inferShape } from '../browser/shape.js';
import { TargetError, type TargetErrorCode } from '../browser/target-errors.js';
import { getAttributesResolvedJs, getTextResolvedJs, getValueResolvedJs, isAutocompleteResolvedJs, resolveTargetJs, selectResolvedJs, type ResolveOptions, type TargetMatchLevel } from '../browser/target-resolver.js';
import { EXIT_CODES, getErrorMessage } from '../errors.js';
import { ExtensionReloadError, readDiskBuildId, readExtensionInfo, reloadExtension } from '../extension-reload.js';
import { findPackageRoot } from '../package-paths.js';
import { VisualActionError, captureVisualSnapshot, encodeVisualCapture, decodeVisualCapture, assertVisualSnapshot, parseVisualPoint, isProtectedAttachError } from '../browser/visual-action.js';
import { fileURLToPath } from 'node:url';
import { installCommanderNamespaceStructuredHelp } from '../help.js';
import { log } from '../logger.js';
import type { BrowserWindowMode } from '../runtime.js';
import type { BrowserDownloadWaitResult, IPage, ScreenshotOptions } from '../types.js';


import { emitHook, type HookContext } from '../hooks.js';
import { captureCommandOutput, type CommandOutputCapture, emitFailure, emitResult } from '../command-output.js';
const BROWSER_TAB_OPTION_DESCRIPTION = 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"';
const FOLLOW_POLL_MS = 1_000;
const BROWSER_COMMANDS_FILE = fileURLToPath(import.meta.url);

function reportVisualError(error: VisualActionError): void {
  emitFailure({ code: error.code, message: error.message, ...(error.hint && { hint: error.hint }) }, EXIT_CODES.USAGE_ERROR);
}

function reportVisualUnknown(error: unknown): void {
  emitFailure({
    code: 'outcome_unknown',
    message: 'The visual action may have reached the page.',
    details: getErrorMessage(error),
    hint: 'Inspect this exact tab and reconcile the result before any retry.',
  }, EXIT_CODES.GENERIC_ERROR);
}

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
  /** Epoch milliseconds when the request was observed. */
  timestamp?: number;
  /** Sanitized request context captured by CDP. */
  request?: SafeNetworkRequest;
};

function parseDurationMs(raw: unknown, flagName: string): number | null | { error: string } {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(str);
  if (!match) return { error: `--${flagName} must be a duration like 500ms, 30s, 2m, got "${str}"` };
  const value = Number.parseFloat(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

function timestampFromRaw(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now();
}

function toIsoTimestamp(timestamp: unknown): string | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return new Date(timestamp).toISOString();
}

function filterByTimeWindow<T extends { timestamp?: number }>(items: T[], opts: { sinceMs?: number | null; untilMs?: number | null }, now: number = Date.now()): T[] {
  const sinceTs = opts.sinceMs != null ? now - opts.sinceMs : undefined;
  const untilTs = opts.untilMs != null ? now - opts.untilMs : undefined;
  return items.filter((item) => {
    const ts = item.timestamp ?? now;
    if (sinceTs !== undefined && ts < sinceTs) return false;
    if (untilTs !== undefined && ts > untilTs) return false;
    return true;
  });
}

export function selectFreshByTimestamp<T extends { timestamp?: unknown }>(
  items: T[],
  lastSeenTs: number,
): { fresh: T[]; lastSeenTs: number } {
  const fresh = items.filter((item) => Number(item.timestamp ?? 0) > lastSeenTs);
  const nextSeenTs = fresh.length > 0
    ? Math.max(lastSeenTs, ...fresh.map((item) => Number(item.timestamp ?? 0)).filter(Number.isFinite))
    : lastSeenTs;
  return { fresh, lastSeenTs: nextSeenTs };
}

async function captureNetworkItems(page: import('../types.js').IPage): Promise<BrowserNetworkItem[]> {
  if (page.readNetworkCapture) {
    const raw = await page.readNetworkCapture();
    if (Array.isArray(raw) && raw.length > 0) {
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
        const request = sanitizeCapturedRequest({
          headers: e.requestHeaders,
          bodyKind: e.requestBodyKind,
          bodyPreview: e.requestBodyPreview,
          bodyFullSize: e.requestBodyFullSize,
          bodyTruncated: e.requestBodyTruncated,
        });
        return {
          url: sanitizeCapturedUrl((e.url as string) || ''),
          method: (e.method as string) || 'GET',
          status: (e.responseStatus as number) || 0,
          size: fullSize,
          ct: (e.responseContentType as string) || '',
          body,
          bodyFullSize: fullSize,
          bodyTruncated: truncated,
          timestamp: timestampFromRaw(e.timestamp),
          ...(request ? { request } : {}),
        };
      });
    }
  }
  const raw = await page.evaluate(`(function(){ var out = window.__opencli_net || []; window.__opencli_net = []; return JSON.stringify(out); })()`) as string;
  try {
    const parsed = JSON.parse(raw) as BrowserNetworkItem[];
    return parsed.map((item) => ({
      ...item,
      url: sanitizeCapturedUrl(item.url),
      timestamp: timestampFromRaw(item.timestamp),
    }));
  } catch {
    if (process.env.OPENCLI_VERBOSE) log.warn(`[network] Failed to parse interceptor buffer: ${typeof raw === 'string' ? raw.slice(0, 200) : String(raw)}`);
    return [];
  }
}

/** Drop static-resource / telemetry noise so agents see only API-shaped traffic. */
function filterNetworkItems<T extends Pick<BrowserNetworkItem, 'url' | 'ct'>>(items: T[]): T[] {
  return items.filter((r) => {
    const ct = r.ct?.toLowerCase() ?? '';
    return (
      (ct.includes('json') || ct.includes('xml') || ct.includes('text/plain') || ct.includes('javascript') || ct.includes('text/x-component') || /\/rsc-action(?:\/|\?|$)/i.test(r.url)) &&
      !/\.(js|css|png|jpg|gif|svg|woff|ico|map)(\?|$)/i.test(r.url) &&
      !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url)
    );
  });
}

/** Exit codes by network error code — usage errors vs runtime failures. */
const NETWORK_ERROR_EXIT: Record<string, number> = {
  invalid_args: EXIT_CODES.USAGE_ERROR,
  invalid_filter: EXIT_CODES.USAGE_ERROR,
  invalid_max_body: EXIT_CODES.USAGE_ERROR,
};

/** Emit a structured error JSON so agents can branch on `error.code` without regex. */
function emitNetworkError(code: string, message: string, extra: Record<string, unknown> = {}): void {
  emitFailure({ code, message, ...extra }, NETWORK_ERROR_EXIT[code] ?? EXIT_CODES.GENERIC_ERROR);
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

function getBrowserTargetStatePath(scope: string): string {
  const safeSession = scope.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return path.join(getBrowserCacheDir(), 'browser-state', `${safeSession}.json`);
}

function loadBrowserTargetState(scope: string): BrowserTargetState | null {
  try {
    const raw = fs.readFileSync(getBrowserTargetStatePath(scope), 'utf-8');
    const parsed = JSON.parse(raw) as BrowserTargetState | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveBrowserTargetState(defaultPage: string | undefined, scope: string): void {
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
  page: import('../types.js').IPage,
  targetPage: string,
  opts: { scope: string; source: 'explicit' | 'saved' },
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
      'The Browser Bridge session may have restarted; re-run "opencli browser tab list" and choose a current target.',
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
    'The Browser Bridge session may have restarted; re-run "opencli browser tab list" and choose a current target.',
  );
}

function getBrowserScope(session: string, contextId?: string): string {
  return contextId ? `${contextId}:${session}` : session;
}

async function resolveStoredBrowserTarget(page: import('../types.js').IPage, scope: string): Promise<string | undefined> {
  const defaultPage = loadBrowserTargetState(scope)?.defaultPage?.trim();
  if (!defaultPage) return undefined;
  return resolveBrowserTargetInSession(page, defaultPage, { scope, source: 'saved' });
}

/** Create a browser page for browser commands. Uses a named browser session for continuity. */
async function getBrowserPage(
  session: string,
  targetPage?: string,
  profileSelection?: ProfileSelection,
  opts: { windowMode?: BrowserWindowMode } = {},
): Promise<import('../types.js').IPage> {
  const { BrowserBridge } = await import('../browser/index.js');
  const bridge = new BrowserBridge();
  // Internal GC timeout for browser sessions. Not the per-command runtime timeout.
  const envTimeout = process.env.OPENCLI_BROWSER_IDLE_TIMEOUT;
  const idleTimeout = envTimeout ? parseInt(envTimeout, 10) : undefined;
  const page = await bridge.connect({
    timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT,
    session,
    surface: 'browser',
    ...profileRouteParams(profileSelection),
    ...(idleTimeout && idleTimeout > 0 && { idleTimeout }),
    windowMode: opts.windowMode ?? getBrowserWindowMode(undefined, 'foreground'),
  });
  const targetScope = getBrowserScope(session, profileSelection?.contextId);
  const resolvedTargetPage = targetPage
    ? await resolveBrowserTargetInSession(page, targetPage, { scope: targetScope, source: 'explicit' })
    : await resolveStoredBrowserTarget(page, targetScope);
  if (resolvedTargetPage) {
    if (!page.setActivePage) {
      throw new Error('This browser session does not support explicit tab targeting');
    }
    page.setActivePage(resolvedTargetPage);
  }
  return page;
}

function getBrowserWindowMode(command: Command | undefined, defaultMode: BrowserWindowMode): BrowserWindowMode {
  const optionRaw = getCommandOption(command, 'window');
  if (optionRaw !== undefined && optionRaw !== '') {
    if (optionRaw === 'foreground' || optionRaw === 'background') return optionRaw;
    throw new Error(`--window must be one of: foreground, background. Received: "${String(optionRaw)}"`);
  }
  const envRaw = process.env.OPENCLI_WINDOW;
  if (envRaw !== undefined && envRaw !== '') {
    if (envRaw === 'foreground' || envRaw === 'background') return envRaw;
    throw new Error(`OPENCLI_WINDOW must be one of: foreground, background. Received: "${envRaw}"`);
  }
  return defaultMode;
}

function addBrowserTabOption(command: Command): Command {
  return command.option('--tab <targetId>', BROWSER_TAB_OPTION_DESCRIPTION);
}

function getBrowserTargetId(command?: Command): string | undefined {
  if (!command) return undefined;
  const opts = command.optsWithGlobals ? command.optsWithGlobals() : command.opts();
  return typeof opts.tab === 'string' && opts.tab.trim() ? opts.tab.trim() : undefined;
}

function getCommandOption(command: Command | undefined, option: string): unknown {
  let current: Command | undefined = command;
  while (current) {
    const opts = current.opts();
    if (Object.prototype.hasOwnProperty.call(opts, option) && opts[option] !== undefined) return opts[option];
    current = current.parent as Command | undefined;
  }
  return undefined;
}

function getBrowserSession(command?: Command): string {
  const raw = getCommandOption(command, 'session');
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  throw Object.assign(new Error('Page commands require --session <name>.'), { code: 'usage_error' });
}

function getBrowserProfileSelection(command?: Command): ProfileSelection | undefined {
  const raw = getCommandOption(command, 'profile');
  return resolveProfileSelection(typeof raw === 'string' && raw.trim() ? raw.trim() : undefined);
}

function getPageSession(page: import('../types.js').IPage): string {
  const session = (page as unknown as { session?: unknown }).session;
  if (typeof session === 'string' && session.trim()) return session.trim();
  throw new Error('Browser page is missing a session');
}

function getPageScope(page: import('../types.js').IPage): string {
  // Scope is keyed by the SELECTED profile (explicit or preferred), matching
  // getBrowserPage's targetScope — reading only the explicit contextId would
  // save and look up the remembered tab under different keys whenever the
  // profile came from the config default.
  const { contextId, preferredContextId } = page as unknown as { contextId?: unknown; preferredContextId?: unknown };
  const selected = typeof contextId === 'string' && contextId.trim()
    ? contextId.trim()
    : (typeof preferredContextId === 'string' && preferredContextId.trim() ? preferredContextId.trim() : undefined);
  return getBrowserScope(getPageSession(page), selected);
}

type SnapshotSource = 'dom' | 'ax';

function snapshotMetricText(snapshot: unknown): string {
  return typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2);
}

function snapshotMetrics(snapshot: unknown, elapsedMs: number): Record<string, unknown> {
  const text = snapshotMetricText(snapshot);
  const interactiveMatch = text.match(/^interactive:\s*(\d+)\s*$/m);
  return {
    ok: true,
    chars: text.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text ? text.split(/\r?\n/).length : 0,
    approx_tokens: Math.ceil(text.length / 4),
    refs: (text.match(/(^|\n)\s*\[\d+\]/g) ?? []).length,
    frame_sections: (text.match(/(^|\n)frame /g) ?? []).length,
    ...(interactiveMatch ? { interactive: Number(interactiveMatch[1]) } : {}),
    elapsed_ms: elapsedMs,
  };
}

async function snapshotSourceMetrics(page: IPage, source: SnapshotSource): Promise<Record<string, unknown>> {
  const started = Date.now();
  try {
    const snapshot = await page.snapshot({ viewportExpand: 2000, source });
    return snapshotMetrics(snapshot, Date.now() - started);
  } catch (err) {
    return {
      ok: false,
      elapsed_ms: Date.now() - started,
      error: {
        ...(err instanceof Error && 'code' in err ? { code: String((err as { code?: unknown }).code) } : {}),
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function resolveBrowserTabTarget(targetId?: string, opts?: { tab?: string } | Command): string | undefined {
  if (typeof targetId === 'string' && targetId.trim()) return targetId.trim();
  const tab = opts instanceof Command ? opts.opts().tab : opts?.tab;
  if (typeof tab === 'string' && tab.trim()) return tab.trim();
  return undefined;
}

function parsePositiveIntOption(val: string | undefined, label: string, fallback: number): number {
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    emitFailure(`[cli] Invalid ${label}="${val}", using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function parseScreenshotDim(val: string, label: string): number {
  if (!/^\d+$/.test(val)) {
    throw new InvalidArgumentError(`--${label} must be a positive integer (got "${val}")`);
  }
  const parsed = parseInt(val, 10);
  if (parsed <= 0) {
    throw new InvalidArgumentError(`--${label} must be a positive integer (got "${val}")`);
  }
  return parsed;
}


/**
 * Releasing a lease keeps opencli's windows for reuse, because the next command
 * would otherwise open a new window in front of the user. Closing them is an
 * explicit "done with the browser" step, e.g. at the end of a scheduled run.
 */
export function registerWindowsCommands(program: Command): Command {
  const windowsCmd = program.command('windows').description('Manage the browser windows opencli opens');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalWindowsDescription = windowsCmd.description();
  windowsCmd
    .command('close')
    .description('Close the adapter and browser-session windows opencli opened in this profile; a window with a command still running stays open')
    .action(async (_opts: unknown, command: Command) => {
      try {
        // Only an explicit --profile is routed here; without one the transport
        // resolves OPENCLI_PROFILE and the configured default itself.
        const profile = getCommandOption(command, 'profile');
        const explicit = typeof profile === 'string' && profile.trim() ? resolveProfileSelection(profile.trim()) : undefined;
        emitResult(await sendCommand('close-owned-windows', profileRouteParams(explicit)));
      } catch (err) {
        if (/Unknown action: close-owned-windows/.test(getErrorMessage(err))) {
          emitFailure({ code: 'extension_outdated', message: getErrorMessage(err), hint: 'The loaded OpenCLI extension predates this command; reload it in the browser\'s extensions page.' });
        } else {
          emitFailure(err);
        }
      }
    });
  installCommanderNamespaceStructuredHelp(windowsCmd, { globalCommand: program, description: originalWindowsDescription });
  return windowsCmd;
}

/**
 * An unpacked extension runs new code only after a reload. `extension reload`
 * asks the extension to reload itself and waits until it runs the build on
 * disk, so an agent never needs the browser's extensions page.
 */
export function registerExtensionCommands(program: Command): Command {
  const extensionCmd = program.command('extension').description('Check or reload the OpenCLI browser extension in a profile');
  const originalExtensionDescription = extensionCmd.description();
  const extensionRoute = (command: Command) => {
    // Only an explicit --profile is routed here; without one the transport
    // resolves OPENCLI_PROFILE and the configured default itself.
    const profile = getCommandOption(command, 'profile');
    const explicit = typeof profile === 'string' && profile.trim() ? resolveProfileSelection(profile.trim()) : undefined;
    return profileRouteParams(explicit) as Record<string, unknown>;
  };
  const extensionSend = (action: 'extension-info' | 'reload-extension', params: Record<string, unknown>) => sendCommand(action, params);
  const failExtensionCommand = (err: unknown) => {
    if (err instanceof ExtensionReloadError) {
      emitFailure({ code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }, EXIT_CODES.GENERIC_ERROR);
    } else {
      emitFailure(err);
    }
  };
  extensionCmd
    .command('info')
    .description('Show the extension build this profile runs and whether it matches the build on disk')
    .action(async (_opts: unknown, command: Command) => {
      try {
        const info = await readExtensionInfo(extensionSend, extensionRoute(command));
        const disk = readDiskBuildId(findPackageRoot(BROWSER_COMMANDS_FILE));
        emitResult({ ...info, diskBuildId: disk, current: disk !== null && info.buildId === disk });
      } catch (err) {
        failExtensionCommand(err);
      }
    });
  extensionCmd
    .command('reload')
    .description('Reload the extension from disk in this profile and wait until it runs the on-disk build; refuses while a command is running')
    .option('--force', 'Reload even while an interactive browser session holds a tab (the reload drops that tab)')
    .option('--timeout <seconds>', 'Seconds to wait for the reloaded extension to reconnect', '30')
    .action(async (opts: { force?: boolean; timeout?: string }, command: Command) => {
      try {
        const timeoutSeconds = Number.parseInt(String(opts.timeout ?? '30'), 10);
        emitResult(await reloadExtension({
          send: extensionSend,
          diskBuildId: readDiskBuildId(findPackageRoot(BROWSER_COMMANDS_FILE)),
          route: extensionRoute(command),
          force: opts.force === true,
          timeoutMs: (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 30) * 1000,
        }));
      } catch (err) {
        failExtensionCommand(err);
      }
    });
  installCommanderNamespaceStructuredHelp(extensionCmd, { globalCommand: program, description: originalExtensionDescription });
  return extensionCmd;
}

export function registerBrowserCommands(program: Command): Command {
  const browser = program.command('browser')
    .option('--session <name>', 'Page session (required for page commands)')
    .option('--window <mode>', 'Browser window mode: foreground or background')
    .description('Inspect pages, interact with elements, and manage Chrome resources');
  const originalBrowserDescription = browser.description();

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
    emitFailure({
      code: err.code,
      message: err.message,
      hint: err.hint,
      ...(err.candidates && { candidates: err.candidates }),
      ...(err.matches_n !== undefined && { matches_n: err.matches_n }),
    });
  }

  function isJavaScriptDialogMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('javascript dialog');
  }

  function emitJavaScriptDialogError(message: string): void {
    emitFailure({
      code: 'javascript_dialog_open',
      message,
      hint: 'Handle the modal first: opencli browser dialog accept (or dismiss). Use --text for prompt dialogs.',
    });
  }

  function emitBrowserCommandErrorEnvelope(err: BrowserCommandError): void {
    if (!err.code) return;
    emitFailure({
      code: err.code,
      message: err.message,
      ...(err.hint ? { hint: err.hint } : {}),
    });
  }

  function logBrowserCommandError(err: BrowserCommandError): void {
    log.error(err.message);
    if (err.hint) log.error(`Hint: ${err.hint}`);
  }

  function browserLifecycle<Args extends unknown[]>(action: (...args: Args) => Promise<unknown>) {
    return async (...args: Args) => {
      const command = args.at(-1) instanceof Command ? args.at(-1) as Command : undefined;
      const names: string[] = [];
      for (let node = command; node && node !== browser; node = node.parent ?? undefined) names.unshift(node.name());
      const hookArgs: Record<string, unknown> = { ...command?.optsWithGlobals() };
      command?.registeredArguments.forEach((argument, index) => {
        hookArgs[argument.name()] = command.processedArgs[index];
      });
      const context: HookContext = { command: ['browser', ...names].join('/'), args: hookArgs, startedAt: Date.now() };
      const output: CommandOutputCapture = {};
      await emitHook('onBeforeExecute', context);
      try {
        await captureCommandOutput(output, () => action(...args));
      } catch (error) {
        context.error = error;
        throw error;
      } finally {
        context.error ??= output.error;
        context.finishedAt = Date.now();
        await emitHook('onAfterExecute', context, output.result);
      }
    };
  }

  /** Wrap browser actions with error handling and optional --json output */
  function browserAction<Args extends unknown[]>(fn: (page: Awaited<ReturnType<typeof getBrowserPage>>, ...args: Args) => Promise<unknown>) {
    return browserLifecycle(async (...args: Args) => {
      let page: Awaited<ReturnType<typeof getBrowserPage>> | null = null;
      try {
        const command = args.at(-1) instanceof Command ? args.at(-1) as Command : undefined;
        const targetPage = getBrowserTargetId(command);
        const session = getBrowserSession(command);
        const profileSelection = getBrowserProfileSelection(command);
        const windowMode = getBrowserWindowMode(command, 'foreground');
        page = await getBrowserPage(session, targetPage, profileSelection, { windowMode });
        await fn(page, ...args);
      } catch (err) {
        if (isJavaScriptDialogMessage(getErrorMessage(err))) emitJavaScriptDialogError(getErrorMessage(err));
        else emitFailure(err);
      }
    });
  }

  type BrowserSessionCommandContext = {
    session: string;
    contextId?: string;
  };

  function browserSessionCommandAction(fn: (ctx: BrowserSessionCommandContext) => Promise<void>) {
    return browserLifecycle(async (optsOrCommand: unknown, maybeCommand?: Command) => {
      const command = optsOrCommand instanceof Command ? optsOrCommand : maybeCommand;
      try {
        const session = getBrowserSession(command);
        const profileSelection = getBrowserProfileSelection(command);
        const contextId = profileSelection?.contextId;
        const { BrowserBridge } = await import('../browser/index.js');
        const bridge = new BrowserBridge();
        await bridge.connect({ timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT, session, surface: 'browser', ...profileRouteParams(profileSelection) });
        await fn({ session, contextId });
      } catch (err) { emitFailure(err); }
    });
  }

  browser.command('bind')
    .description('Bind the current Chrome tab/window to the browser session named by <session>')
    .action(browserSessionCommandAction(async ({ session, contextId }) => {
      const data = await bindTab(session, { ...(contextId && { contextId }) });
      saveBrowserTargetState(undefined, getBrowserScope(session, contextId));
      emitResult({ session, ...((data && typeof data === 'object') ? data as Record<string, unknown> : { data }) });
    }));

  browser.command('unbind')
    .description('Detach the bound browser session named by <session> without closing the user tab/window')
    .action(browserSessionCommandAction(async ({ session, contextId }) => {
      await sendCommand('close-window', { session, surface: 'browser', ...(contextId && { contextId }) });
      saveBrowserTargetState(undefined, getBrowserScope(session, contextId));
      emitResult({ unbound: true, session });
    }));

  const browserTab = browser
    .command('tab')
    .description('Tab management — list, create, and close tabs in the browser session');

  browserTab.command('list')
    .description('List tabs in the browser session with target IDs')
    .action(browserAction(async (page) => {
      const tabs = await page.tabs();
      emitResult(tabs);
    }));

  browserTab.command('new')
    .argument('[url]', 'Optional URL to open in the new tab')
    .description('Create a new tab and print its target ID')
    .action(browserAction(async (page, url?: string) => {
      if (!page.newTab) {
        throw new Error('This browser session does not support creating tabs');
      }
      const createdPage = await page.newTab(url);
      emitResult({
        page: createdPage,
        url: url ?? null,
      });
    }));

  addBrowserTabOption(browserTab.command('select')
    .argument('[targetId]', 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"')
    .description('Select a tab by target ID and make it the default browser tab'))
    .action(browserAction(async (page, targetId?: string, opts?: { tab?: string } | Command) => {
      const resolvedTarget = resolveBrowserTabTarget(targetId, opts);
      if (!resolvedTarget) {
        throw new Error('Target tab required. Pass it as an argument or --tab <targetId>.');
      }
      await page.selectTab(resolvedTarget);
      saveBrowserTargetState(resolvedTarget, getPageScope(page));
      emitResult({ selected: resolvedTarget });
    }));

  addBrowserTabOption(browserTab.command('close')
    .argument('[targetId]', 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"')
    .description('Close a tab by target ID'))
    .action(browserAction(async (page, targetId?: string, opts?: { tab?: string } | Command) => {
      const resolvedTarget = resolveBrowserTabTarget(targetId, opts);
      if (!page.closeTab) {
        throw new Error('This browser session does not support closing tabs');
      }
      if (!resolvedTarget) {
        throw new Error('Target tab required. Pass it as an argument or --tab <targetId>.');
      }
      const validatedTarget = await resolveBrowserTargetInSession(page, resolvedTarget, {
        scope: getPageScope(page),
        source: 'explicit',
      });
      if (!validatedTarget) {
        throw new Error(`Target tab ${resolvedTarget} is not part of the current browser session.`);
      }
      await page.closeTab(validatedTarget);
      const scope = getPageScope(page);
      if (loadBrowserTargetState(scope)?.defaultPage === validatedTarget) {
        saveBrowserTargetState(undefined, scope);
      }
      emitResult({ closed: validatedTarget });
    }));

  // ── Navigation ──

  addBrowserTabOption(browser.command('open').argument('<url>').description('Open URL in the browser session'))
    .action(browserAction(async (page, url) => {
      // Start session-level capture before navigation (catches initial requests)
      const hasSessionCapture = await page.startNetworkCapture?.() ?? false;
      await page.goto(url);
      await page.wait(2);
      // Fallback: inject JS interceptor when session capture is unavailable
      if (!hasSessionCapture) {
        try { await page.evaluate(NETWORK_INTERCEPTOR_JS); } catch { /* non-fatal */ }
      }
      const currentUrl = await page.getCurrentUrl?.() ?? url;
      emitResult({
        url: currentUrl,
        ...(page.getActivePage?.() ? { page: page.getActivePage?.() } : {}),
      });
    }));

  addBrowserTabOption(browser.command('back').description('Go back in browser history'))
    .action(browserAction(async (page) => {
      await page.evaluate('history.back()');
      await page.wait(2);
      emitResult('Navigated back');
    }));

  addBrowserTabOption(browser.command('scroll').argument('<direction>', 'up or down').option('--amount <pixels>', 'Pixels to scroll', '500'))
    .description('Scroll page')
    .action(browserAction(async (page, direction, opts) => {
      if (direction !== 'up' && direction !== 'down') {
        emitFailure(`Invalid direction "${direction}". Use "up" or "down".`, EXIT_CODES.USAGE_ERROR);
        return;
      }
      await page.scroll(direction, parseInt(opts.amount, 10));
      emitResult(`Scrolled ${direction}`);
    }));

  // ── Inspect ──

  addBrowserTabOption(browser.command('state').description('Page state: URL, title, interactive elements with [N] indices')
    .option('--source <source>', 'Snapshot backend: dom (default) or ax prototype', 'dom')
    .option('--diagnostics', 'Include page facts: title, URL and initial-state globals')
    .option('--compare-sources', 'Print DOM vs AX snapshot metrics for observation promotion decisions', false))
    .action(browserAction(async (page, opts) => {
      if (opts.compareSources === true) {
        const [dom, ax] = await Promise.all([
          snapshotSourceMetrics(page, 'dom'),
          snapshotSourceMetrics(page, 'ax'),
        ]);
        emitResult({
          url: await page.getCurrentUrl?.() ?? '',
          sources: { dom, ax },
        });
        return;
      }
      const source = String(opts.source ?? 'dom').toLowerCase();
      if (source !== 'dom' && source !== 'ax') {
        emitFailure({
          code: 'invalid_source',
          message: `--source must be "dom" or "ax", got "${opts.source}"`,
        }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const snapshot = await page.snapshot({ viewportExpand: 2000, source: source as 'dom' | 'ax' });
      const url = await page.getCurrentUrl?.() ?? '';
      const diagnostics = opts.diagnostics ? await page.evaluate(`(() => ({
        title: document.title, url: location.href,
        initialState: ['__INITIAL_STATE__','__NUXT__','__NEXT_DATA__','__APOLLO_STATE__'].filter(key => typeof window[key] !== 'undefined')
      }))()`) : undefined;
      emitResult({ url, snapshot, ...(diagnostics ? { diagnostics } : {}) });
    }));

  addBrowserTabOption(browser.command('frames').description('List cross-origin iframe targets in snapshot order'))
    .action(browserAction(async (page) => {
      const frames = await page.frames?.() ?? [];
      emitResult(frames);
    }));

  addBrowserTabOption(browser.command('screenshot').argument('[path]', 'Save to file (base64 if omitted)'))
    .option('--full-page', 'Capture the full scrollable page, not just the viewport', false)
    .option('--annotate', 'Overlay visible browser state ref labels on the screenshot', false)
    .option('--width <n>', 'Override viewport width in CSS pixels for this screenshot only', (v: string) => parseScreenshotDim(v, 'width'))
    .option('--height <n>', 'Override viewport height in CSS pixels for this screenshot only (ignored with --full-page)', (v: string) => parseScreenshotDim(v, 'height'))
    .option('--for-click', 'Capture an unmodified viewport with a short-lived point-click descriptor', false)
    .description('Take screenshot')
    .action(browserAction(async (page, path, opts) => {
      if (opts.forClick === true) {
        const tab = typeof opts.tab === 'string' ? opts.tab : '';
        if (!path || !tab || page.getActivePage?.() !== tab
            || opts.fullPage === true || opts.annotate === true
            || opts.width !== undefined || opts.height !== undefined) {
          reportVisualError(new VisualActionError(
            'visual_usage',
            '--for-click requires a screenshot path and exact --tab; --full-page, --annotate, --width, and --height are not supported.',
          ));
          return;
        }
        try {
          const snapshot = await captureVisualSnapshot(page);
          fs.writeFileSync(path, snapshot.png);
          emitResult({
            path,
            tab,
            image: { width: snapshot.imageWidth, height: snapshot.imageHeight },
            cssViewport: { width: snapshot.cssWidth, height: snapshot.cssHeight },
            capture: encodeVisualCapture(snapshot, tab),
            input: snapshot.transport === 'extension' ? 'synthetic' : 'native',
          });
        } catch (err) {
          if (err instanceof VisualActionError) { reportVisualError(err); return; }
          throw err;
        }
        return;
      }
      const shotOpts: ScreenshotOptions = {
        fullPage: opts.fullPage === true,
        annotate: opts.annotate === true,
        width: opts.width,
        height: opts.height,
      };
      const capture = opts.annotate === true
        ? (page.annotatedScreenshot ?? page.screenshot).bind(page)
        : page.screenshot.bind(page);
      if (path) {
        await capture({ ...shotOpts, path });
        emitResult(`Screenshot saved to: ${path}`);
      } else {
        emitResult(await capture({ ...shotOpts, format: 'png' }));
      }
    }));

  addBrowserTabOption(browser.command('console'))
    .option('--level <level>', 'Console level: all, error, warning, log, info, debug', 'all')
    .option('--since <duration>', 'Only include messages from the last duration (for example: 30s, 2m)')
    .option('--until <duration>', 'Only include messages older than the duration from now')
    .option('--follow', 'Continuously print new console messages as JSON lines', false)
    .description('Read recent browser console messages')
    .action(browserAction(async (page, opts) => {
      const sinceMs = parseDurationMs(opts.since, 'since');
      const untilMs = parseDurationMs(opts.until, 'until');
      if (sinceMs && typeof sinceMs === 'object') {
        emitFailure({ code: 'invalid_since', message: sinceMs.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      if (untilMs && typeof untilMs === 'object') {
        emitFailure({ code: 'invalid_until', message: untilMs.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const normalize = (messages: unknown[]): Array<Record<string, unknown>> => messages.map((message) => {
        if (message && typeof message === 'object') {
          const record = message as Record<string, unknown>;
          return {
            ...record,
            timestamp: timestampFromRaw(record.timestamp),
          };
        }
        return { type: 'log', text: String(message), timestamp: Date.now() };
      });
      const filter = (messages: Array<Record<string, unknown>>) =>
        filterByTimeWindow(messages, { sinceMs, untilMs }).filter((message) => {
          if (opts.level === 'all') return true;
          const type = String(message.type ?? message.level ?? '').toLowerCase();
          return opts.level === 'error'
            ? type === 'error' || type === 'warning'
            : type === String(opts.level).toLowerCase();
        });

      if (opts.follow) {
        let lastSeenTs = 0;
        while (true) {
          const messages = filter(normalize(await page.consoleMessages('all')));
          const next = selectFreshByTimestamp(messages, lastSeenTs);
          for (const message of next.fresh) {
            emitResult({
              ...message,
              timestamp: toIsoTimestamp(message.timestamp),
            });
          }
          lastSeenTs = next.lastSeenTs;
          await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
        }
      }

      const messages = filter(normalize(await page.consoleMessages(opts.level)));
      emitResult({
        session: getPageSession(page),
        captured_at: new Date().toISOString(),
        count: messages.length,
        messages: messages.map((message) => ({
          ...message,
          timestamp: toIsoTimestamp(message.timestamp),
        })),
      });
    }));

  // ── Native Chrome management ──
  const nativeChrome = browser.command('chrome').description('Manage native Chrome tabs, groups and windows without attaching a page');
  const nativeAction = (mode: 'chrome-call' | 'chrome-describe') => browserLifecycle(async (...args: any[]) => {
    try {
      const command = args.at(-1) as Command;
      const method = args[0] as string | undefined;
      const chromeArgs = mode === 'chrome-call' ? JSON.parse(args[1]) : [];
      if (!Array.isArray(chromeArgs)) throw Object.assign(new Error('Chrome arguments must be a JSON array.'), { code: 'invalid_args' });
      const result = await sendCommand(mode, {
        surface: 'browser',
        ...profileRouteParams(getBrowserProfileSelection(command)), chromeMethod: method, chromeArgs
      });
      emitResult(result);
    } catch (error) {
      const err = error as Error & { code?: string };
      emitFailure(err instanceof SyntaxError ? { code: 'invalid_args', message: err.message, exitCode: 2 } : err);
    }
  });
  nativeChrome.command('describe').argument('[method]').description('List supported methods or inspect signature and live permissions').action(nativeAction('chrome-describe'));
  nativeChrome.command('call').argument('<method>').argument('[args]', 'JSON array of native positional arguments', '[]')
    .description('Call a Chrome browser-management method; created resources persist').action(nativeAction('chrome-call'));

  // ── Find (structured CSS query, agent-native) ──
  //
  // `browser find --css <sel>` lets agents jump straight from a semantic
  // selector to a JSON list of matching elements, without having to parse
  // the free-text state snapshot to recover indices.
  const addSemanticLocatorOptions = (cmd: Command): Command => cmd
    .option('--role <role>', 'Semantic role (button, link, textbox, option, etc.)')
    .option('--name <text>', 'Accessible name contains text (aria-label, label, title, placeholder, or visible text)')
    .option('--label <text>', 'Associated label contains text')
    .option('--text <text>', 'Visible text contains text')
    .option('--testid <id>', 'data-testid / data-test / test-id contains id');

  const addPrefixedSemanticLocatorOptions = (cmd: Command, prefix: string): Command => cmd
    .option(`--${prefix}-role <role>`, `${prefix} semantic role`)
    .option(`--${prefix}-name <text>`, `${prefix} accessible name contains text`)
    .option(`--${prefix}-label <text>`, `${prefix} associated label contains text`)
    .option(`--${prefix}-text <text>`, `${prefix} visible text contains text`)
    .option(`--${prefix}-testid <id>`, `${prefix} data-testid / data-test / test-id contains id`);

  const semanticLocatorFromOptions = (opts: Record<string, unknown>): SemanticFindOptions | null => {
    const locator: SemanticFindOptions = {};
    for (const key of ['role', 'name', 'label', 'text', 'testid'] as const) {
      const value = opts[key];
      if (typeof value === 'string' && value.trim()) locator[key] = value.trim();
    }
    return Object.keys(locator).length > 0 ? locator : null;
  };

  const prefixedSemanticLocatorFromOptions = (opts: Record<string, unknown>, prefix: string): SemanticFindOptions | null => {
    const locator: SemanticFindOptions = {};
    const map = {
      role: `${prefix}Role`,
      name: `${prefix}Name`,
      label: `${prefix}Label`,
      text: `${prefix}Text`,
      testid: `${prefix}Testid`,
    } as const;
    for (const key of ['role', 'name', 'label', 'text', 'testid'] as const) {
      const value = opts[map[key]];
      if (typeof value === 'string' && value.trim()) locator[key] = value.trim();
    }
    return Object.keys(locator).length > 0 ? locator : null;
  };

  const semanticTargetFromLocator = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    locator: SemanticFindOptions,
    mode: 'read' | 'write',
  ): Promise<string | { target: string; total_matches?: number } | { error: { code: string; message: string; hint?: string; matches_n?: number; entries?: FindResult['entries'] } }> => {
    const result = await page.evaluate(buildSemanticFindJs({ ...locator, limit: 6 })) as FindResult | FindError;
    if (isFindError(result)) return result;
    if (mode === 'write' && result.matches_n !== 1) {
      return {
        error: {
          code: 'semantic_ambiguous',
          message: `Semantic locator matched ${result.matches_n} elements; write actions require a unique target.`,
          hint: 'Add --name/--label/--text/--testid or use browser find with a narrower locator.',
          matches_n: result.matches_n,
          entries: result.entries,
        },
      };
    }
    const first = result.entries[0];
    if (!first) {
      return {
        error: {
          code: 'semantic_not_found',
          message: 'Semantic locator matched 0 elements',
          hint: 'Try browser state, --source ax, or relax the semantic locator.',
        },
      };
    }
    const target = String(first.ref);
    if (mode === 'read') {
      return {
        target,
        ...(result.matches_n > 1 ? { total_matches: result.matches_n } : {}),
      };
    }
    return target;
  };

  const semanticTargetFromOptions = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    opts: Record<string, unknown>,
    mode: 'read' | 'write',
  ): Promise<string | { target: string; total_matches?: number } | { error: { code: string; message: string; hint?: string; matches_n?: number; entries?: FindResult['entries'] } } | null> => {
    const locator = semanticLocatorFromOptions(opts);
    if (!locator) return null;
    return semanticTargetFromLocator(page, locator, mode);
  };

  const resolveExplicitOrSemanticTarget = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    target: unknown,
    opts: Record<string, unknown>,
    mode: 'read' | 'write',
  ): Promise<string | { target: string; total_matches?: number } | { error: { code: string; message: string; hint?: string; matches_n?: number; entries?: FindResult['entries'] } }> => {
    const explicit = typeof target === 'string' && target.trim() ? target.trim() : '';
    const hasSemantic = !!semanticLocatorFromOptions(opts);
    if (explicit && hasSemantic) {
      return {
        error: {
          code: 'usage_error',
          message: 'Pass either <target> or semantic locator flags, not both.',
        },
      };
    }
    if (explicit) return explicit;
    const semantic = await semanticTargetFromOptions(page, opts, mode);
    if (semantic) return semantic;
    return {
      error: {
        code: 'usage_error',
        message: 'Missing target. Pass a numeric ref/CSS selector, or semantic flags like --role button --name Submit.',
      },
    };
  };

  const printTargetResolutionError = (
    resolved: { error: { code: string; message: string; hint?: string; matches_n?: number; entries?: FindResult['entries'] } },
  ): void => {
    emitFailure(resolved.error, EXIT_CODES.USAGE_ERROR);
  };

  const resolveWriteTargetOrPrint = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    target: unknown,
    opts: Record<string, unknown>,
  ): Promise<string | null> => {
    const resolvedTarget = await resolveExplicitOrSemanticTarget(page, target, opts, 'write');
    if (typeof resolvedTarget === 'string') return resolvedTarget;
    if ('error' in resolvedTarget) printTargetResolutionError(resolvedTarget);
    return null;
  };

  const resolveWriteTargetAndValueOrPrint = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    targetOrValue: unknown,
    value: unknown,
    opts: Record<string, unknown>,
    valueLabel: string,
  ): Promise<{ target: string; value: string } | null> => {
    const hasSemantic = !!semanticLocatorFromOptions(opts);
    if (hasSemantic && value !== undefined) {
      printTargetResolutionError({
        error: {
          code: 'usage_error',
          message: `When using semantic locator flags, pass only <${valueLabel}> as the positional argument.`,
        },
      });
      return null;
    }
    const resolvedValue = hasSemantic ? targetOrValue : value;
    if (resolvedValue === undefined) {
      printTargetResolutionError({
        error: {
          code: 'usage_error',
          message: `Missing ${valueLabel}.`,
          hint: hasSemantic
            ? `With semantic locator flags, pass the ${valueLabel} as the only positional argument.`
            : `Pass both a target and ${valueLabel}.`,
        },
      });
      return null;
    }
    const resolvedTarget = await resolveWriteTargetOrPrint(page, hasSemantic ? undefined : targetOrValue, opts);
    if (!resolvedTarget) return null;
    return { target: resolvedTarget, value: String(resolvedValue) };
  };

  const resolvePrefixedWriteTargetOrPrint = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    target: unknown,
    opts: Record<string, unknown>,
    prefix: string,
    label: string,
  ): Promise<string | null> => {
    const explicit = typeof target === 'string' && target.trim() ? target.trim() : '';
    const locator = prefixedSemanticLocatorFromOptions(opts, prefix);
    if (explicit && locator) {
      printTargetResolutionError({
        error: {
          code: 'usage_error',
          message: `Pass either <${label}> or --${prefix}-* semantic locator flags, not both.`,
        },
      });
      return null;
    }
    if (explicit) return explicit;
    if (locator) {
      const resolved = await semanticTargetFromLocator(page, locator, 'write');
      if (typeof resolved === 'string') return resolved;
      if ('error' in resolved) printTargetResolutionError(resolved);
      return null;
    }
    printTargetResolutionError({
      error: {
        code: 'usage_error',
        message: `Missing ${label}. Pass a numeric ref/CSS selector, or --${prefix}-role/--${prefix}-name semantic flags.`,
      },
    });
    return null;
  };

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('find'))
      .option('--css <selector>', 'CSS selector (required)')
      .option('--limit <n>', 'Max entries returned', '50')
      .option('--text-max <n>', 'Max chars of trimmed text per entry', '120')
      .description('Find DOM elements by CSS or semantic locator — returns JSON {matches_n, entries[]}'),
  )
    .action(browserAction(async (page, opts) => {
      const locator = semanticLocatorFromOptions(opts);
      if ((!opts.css || typeof opts.css !== 'string') && !locator) {
        emitFailure({
          code: 'usage_error',
          message: '--css <selector> or a semantic locator flag is required',
          hint: 'Examples: opencli browser find --css ".btn.primary"; opencli browser find --role button --name Save',
        }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      if (opts.css && locator) {
        emitFailure({
          code: 'usage_error',
          message: 'Pass either --css or semantic locator flags, not both.',
        }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const limit = parseNthFlag(opts.limit);
      if (limit && typeof limit === 'object' && 'error' in limit) {
        emitFailure({ code: 'usage_error', message: limit.error.replace('--nth', '--limit') }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const textMax = parseNthFlag(opts.textMax);
      if (textMax && typeof textMax === 'object' && 'error' in textMax) {
        emitFailure({ code: 'usage_error', message: textMax.error.replace('--nth', '--text-max') }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const result = await page.evaluate(
        locator
          ? buildSemanticFindJs({
            ...locator,
            limit: limit as number | null ?? undefined,
            textMax: textMax as number | null ?? undefined,
          })
          : buildFindJs(opts.css, {
            limit: limit as number | null ?? undefined,
            textMax: textMax as number | null ?? undefined,
          }),
      ) as FindResult | FindError;
      if (isFindError(result)) {
        emitFailure(result.error, EXIT_CODES.GENERIC_ERROR);
        return;
      }
      emitResult(result);
    }));

  // ── Get commands (structured data extraction) ──

  const get = browser.command('get').description('Get page properties');

  addBrowserTabOption(get.command('title').description('Page title'))
    .action(browserAction(async (page) => {
      emitResult(await page.evaluate('document.title'));
    }));

  addBrowserTabOption(get.command('url').description('Current page URL'))
    .action(browserAction(async (page) => {
      emitResult(await page.getCurrentUrl?.() ?? await page.evaluate('location.href'));
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
    target: string | undefined,
    opts: Record<string, unknown> & { nth?: string },
    evalJs: string,
    field: 'text' | 'value' | 'attributes',
  ): Promise<void> => {
    const resolvedTarget = await resolveExplicitOrSemanticTarget(page, target, opts, 'read');
    if (typeof resolvedTarget !== 'string' && 'error' in resolvedTarget) {
      emitFailure(resolvedTarget.error, EXIT_CODES.USAGE_ERROR);
      return;
    }
    const targetRef = typeof resolvedTarget === 'string' ? resolvedTarget : resolvedTarget.target;
    const totalMatches = typeof resolvedTarget === 'string' ? undefined : resolvedTarget.total_matches;
    const nth = parseNthFlag(opts.nth);
    if (nth && typeof nth === 'object' && 'error' in nth) {
      emitFailure({ code: 'usage_error', message: nth.error }, EXIT_CODES.USAGE_ERROR);
      return;
    }
    const { matches_n, match_level } = await resolveRef(page, targetRef, {
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
    emitResult({
      value,
      matches_n,
      match_level,
      ...(totalMatches && totalMatches > 1 ? { total_matches: totalMatches } : {}),
    });
  };

  addBrowserTabOption(
    addSemanticLocatorOptions(get.command('text'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Element text content — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, target, opts ?? {}, getTextResolvedJs(), 'text')));

  addBrowserTabOption(
    addSemanticLocatorOptions(get.command('value'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Input/textarea value — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, target, opts ?? {}, getValueResolvedJs(), 'value')));

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
        emitFailure({ code: 'invalid_format', message: `--as must be "html" or "json", got "${opts.as}"` }, EXIT_CODES.USAGE_ERROR);
        return;
      }

      // `--max` is validated up-front (before touching the page) so a bad value
      // gets the same structured error regardless of selector/format path.
      const rawMax = String(opts.max ?? '0');
      if (!/^\d+$/.test(rawMax)) {
        emitFailure({ code: 'invalid_max', message: `--max must be a non-negative integer, got "${opts.max}"` }, EXIT_CODES.USAGE_ERROR);
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
            emitFailure({ code: 'invalid_budget', message: budget.error }, EXIT_CODES.USAGE_ERROR);
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
          emitFailure({ code: 'invalid_selector', message: `Selector "${opts.selector}" is not a valid CSS selector: ${result.reason}` }, EXIT_CODES.USAGE_ERROR);
          return;
        }
        const ok = result as HtmlTreeResult | null;
        if (!ok || ok.matched === 0) {
          emitFailure({
            code: 'selector_not_found',
            message: opts.selector
              ? `Selector "${opts.selector}" matched 0 elements.`
              : 'Page has no documentElement.',
          }, EXIT_CODES.USAGE_ERROR);
          return;
        }
        emitResult(ok);
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
        emitFailure({ code: 'invalid_selector', message: `Selector "${opts.selector}" is not a valid CSS selector: ${rawResult.reason}` }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const html = rawResult.html;

      if (html === null) {
        if (opts.selector) {
          emitFailure({ code: 'selector_not_found', message: `Selector "${opts.selector}" matched 0 elements.` }, EXIT_CODES.USAGE_ERROR);
          return;
        }
        emitResult('(empty)');
        return;
      }
      if (max > 0 && html.length > max) {
        emitResult(`<!-- opencli: truncated ${max} of ${html.length} chars; re-run without --max (or --max 0) for full -->\n${html.slice(0, max)}`);
        return;
      }
      emitResult(html);
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(get.command('attributes'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'Pick the nth match (0-based) when <target> is a multi-match CSS selector')
      .description('Element attributes — JSON envelope {value, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) =>
      runGetCommand(page, target, opts ?? {}, getAttributesResolvedJs(), 'attributes')));

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

  function resolveUploadFilePaths(rawFiles: unknown): { files: string[] } | { error: { code: string; message: string; hint?: string } } {
    const inputs = Array.isArray(rawFiles) ? rawFiles : [];
    if (inputs.length === 0) {
      return {
        error: {
          code: 'usage_error',
          message: 'At least one file path is required.',
          hint: 'Example: opencli browser upload "input[type=file]" ./receipt.pdf',
        },
      };
    }
    const files: string[] = [];
    for (const input of inputs) {
      const raw = String(input);
      const expanded = raw === '~' || raw.startsWith(`~${path.sep}`)
        ? path.join(os.homedir(), raw.slice(2))
        : raw;
      const resolved = path.resolve(expanded);
      if (!fs.existsSync(resolved)) {
        return { error: { code: 'file_not_found', message: `File not found: ${resolved}` } };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { error: { code: 'not_a_file', message: `Not a regular file: ${resolved}` } };
      }
      files.push(resolved);
    }
    return { files };
  }

  function parseResolveFlag(raw: unknown, flag: string): { error: string } | { opts: ResolveOptions } {
    const parsed = parseNthFlag(raw);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { error: parsed.error.replace('--nth', flag) };
    }
    if (typeof parsed === 'number') return { opts: { nth: parsed } };
    return { opts: {} };
  }

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('click'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .option('--point <x,y>', 'Click image-pixel point from a --for-click screenshot')
      .option('--capture <descriptor>', 'Capture descriptor returned by screenshot --for-click')
      .description('Click element — JSON envelope {clicked, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      if (opts?.point !== undefined || opts?.capture !== undefined) {
        const tab = typeof opts.tab === 'string' ? opts.tab : '';
        if (target !== undefined || semanticLocatorFromOptions(opts ?? {}) || opts.nth !== undefined
            || !tab || page.getActivePage?.() !== tab || typeof opts.capture !== 'string') {
          reportVisualError(new VisualActionError('visual_usage', 'Point click requires --point, --capture, and exact --tab, without an element target or semantic locator.'));
          return;
        }
        if (typeof page.cdp !== 'function') {
          reportVisualError(new VisualActionError('visual_unsupported', 'This browser backend does not support CDP visual actions.'));
          return;
        }
        let point: { x: number; y: number };
        let capture;
        try {
          capture = decodeVisualCapture(opts.capture);
          if (capture.tab !== tab) throw new VisualActionError('capture_tab_changed', 'The target tab differs from the screenshot tab.');
          point = parseVisualPoint(opts.point, capture);
        } catch (err) {
          if (err instanceof VisualActionError) { reportVisualError(err); return; }
          throw err;
        }
        try {
          if (capture.transport === 'extension') {
            if (typeof page.visual !== 'function') {
              throw new VisualActionError('visual_unsupported', 'Browser extension visual click is unavailable.');
            }
            await page.visual('hover', point);
            const fresh = await captureVisualSnapshot(page, 'extension');
            assertVisualSnapshot(capture, tab, fresh);
            await page.visual('click', point);
            emitResult({ clicked: true, point: opts.point, tab, input: 'synthetic', outcome: 'dispatched_unverified' });
          } else {
            // Moving can change hover menus. Verify the screenshot only after pointer movement.
            try {
              await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
            } catch (error) {
              if (isProtectedAttachError(error)) {
                throw new VisualActionError('capture_backend_changed', 'Protected extension UI appeared. Take a new screenshot before clicking.');
              }
              throw error;
            }
            const fresh = await captureVisualSnapshot(page);
            assertVisualSnapshot(capture, tab, fresh);
            await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
            await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
            emitResult({ clicked: true, point: opts.point, tab, input: 'native', outcome: 'dispatched_unverified' });
          }
        } catch (err) {
          if (err instanceof VisualActionError) { reportVisualError(err); return; }
          reportVisualUnknown(err);
        }
        return;
      }
      const resolvedTarget = await resolveExplicitOrSemanticTarget(page, target, opts ?? {}, 'write');
      if (typeof resolvedTarget !== 'string' && 'error' in resolvedTarget) {
        emitFailure(resolvedTarget.error, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const clickTarget = typeof resolvedTarget === 'string' ? resolvedTarget : resolvedTarget.target;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const { matches_n, match_level, click_method, hit, retargeted } = await page.click(clickTarget, parsed.opts);
      emitResult({
        clicked: true, target: clickTarget, matches_n, match_level,
        ...(click_method && { click_method }),
        ...(hit && { hit }),
        ...(retargeted && { retargeted }),
      });
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('type'))
      .argument('[targetOrText]', 'Numeric ref/CSS target, or text when using --role/--name/etc.')
      .argument('[text]', 'Text to type')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .option('--focused', 'Insert text into the currently focused text control using native input', false)
      .description('Click element, then type text — JSON envelope {typed, text, target, matches_n, autocomplete}'),
  )
    .action(browserAction(async (page, targetOrText, text, opts) => {
      if (opts?.focused === true) {
        const tab = typeof opts.tab === 'string' ? opts.tab : '';
        if (typeof targetOrText !== 'string' || text !== undefined || !tab
            || page.getActivePage?.() !== tab || semanticLocatorFromOptions(opts ?? {}) || opts.nth !== undefined) {
          reportVisualError(new VisualActionError('visual_usage', 'Focused typing requires one text argument and exact --tab, without a target or semantic locator.'));
          return;
        }
        if (typeof page.nativeType !== 'function') {
          reportVisualError(new VisualActionError('visual_unsupported', 'This browser backend does not support native text insertion.'));
          return;
        }
        let focus: { kind?: string; tag?: string };
        let synthetic = false;
        try {
          focus = await page.evaluate(`(() => {
            let el = document.activeElement;
            while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
            if (!el) return { kind: 'none' };
            if (el.tagName === 'IFRAME') return { kind: 'iframe' };
            if (el.tagName === 'TEXTAREA') return { kind: 'textarea' };
            if (el.tagName === 'INPUT' && !['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(el.type)) return { kind: 'input' };
            if (el.isContentEditable) return { kind: 'contenteditable' };
            return { kind: 'unsupported', tag: el.tagName };
          })()`) as { kind?: string; tag?: string };
        } catch (error) {
          if (!isProtectedAttachError(error) || typeof page.visual !== 'function') throw error;
          focus = await page.visual('focus') as { kind?: string; tag?: string };
          synthetic = true;
        }
        if (!['input', 'textarea', 'contenteditable', 'iframe'].includes(focus?.kind ?? '')) {
          reportVisualError(new VisualActionError('focus_not_text', `Focused element is not a text control (${focus?.tag ?? focus?.kind ?? 'unknown'}).`));
          return;
        }
        try {
          if (synthetic) {
            await page.visual!('type', { text: targetOrText });
          } else {
            try {
              await page.nativeType(targetOrText);
            } catch (error) {
              if (!isProtectedAttachError(error) || typeof page.visual !== 'function') throw error;
              focus = await page.visual('focus') as { kind?: string; tag?: string };
              await page.visual('type', { text: targetOrText });
              synthetic = true;
            }
          }
          emitResult({
            typed: true, characters: targetOrText.length, tab,
            focus: focus.kind, input: synthetic ? 'synthetic' : 'native', outcome: 'dispatched_unverified',
          });
        } catch (err) {
          reportVisualUnknown(err);
        }
        return;
      }
      const resolved = await resolveWriteTargetAndValueOrPrint(page, targetOrText, text, opts ?? {}, 'text');
      if (!resolved) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      // Click first (focuses the field), wait briefly, then type.
      await page.click(resolved.target, parsed.opts);
      await page.wait(0.3);
      const { matches_n, match_level } = await page.typeText(resolved.target, resolved.value, parsed.opts);
      // __resolved is already set by the resolver call inside page.typeText
      const isAutocomplete = await page.evaluate(isAutocompleteResolvedJs()) as boolean;
      if (isAutocomplete) await page.wait(0.4);
      emitResult({
        typed: true,
        text: resolved.value,
        target: resolved.target,
        matches_n,
        match_level,
        autocomplete: !!isAutocomplete,
      });
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('hover'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Move the mouse over an element — JSON envelope {hovered, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      if (typeof page.hover !== 'function') throw new Error('browser hover is not supported by this browser backend');
      const resolvedTarget = await resolveWriteTargetOrPrint(page, target, opts ?? {});
      if (!resolvedTarget) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const { matches_n, match_level } = await page.hover(resolvedTarget, parsed.opts);
      emitResult({ hovered: true, target: resolvedTarget, matches_n, match_level });
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('focus'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Focus an element — JSON envelope {focused, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      if (typeof page.focus !== 'function') throw new Error('browser focus is not supported by this browser backend');
      const resolvedTarget = await resolveWriteTargetOrPrint(page, target, opts ?? {});
      if (!resolvedTarget) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const { focused, matches_n, match_level } = await page.focus(resolvedTarget, parsed.opts);
      emitResult({ focused, target: resolvedTarget, matches_n, match_level });
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('dblclick'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Double-click element — JSON envelope {dblclicked, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      if (typeof page.dblClick !== 'function') throw new Error('browser dblclick is not supported by this browser backend');
      const resolvedTarget = await resolveWriteTargetOrPrint(page, target, opts ?? {});
      if (!resolvedTarget) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const { matches_n, match_level } = await page.dblClick(resolvedTarget, parsed.opts);
      emitResult({ dblclicked: true, target: resolvedTarget, matches_n, match_level });
    }));

  const runCheckCommand = async (
    page: Awaited<ReturnType<typeof getBrowserPage>>,
    target: unknown,
    opts: Record<string, unknown>,
    checked: boolean,
  ): Promise<void> => {
    if (typeof page.setChecked !== 'function') throw new Error(`browser ${checked ? 'check' : 'uncheck'} is not supported by this browser backend`);
    const resolvedTarget = await resolveWriteTargetOrPrint(page, target, opts);
    if (!resolvedTarget) return;
    const parsed = nthToResolveOpts(opts?.nth);
    if ('error' in parsed) {
      emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
      return;
    }
    const result = await page.setChecked(resolvedTarget, checked, parsed.opts);
    emitResult({
      checked: result.checked,
      changed: result.changed,
      target: resolvedTarget,
      matches_n: result.matches_n,
      match_level: result.match_level,
      ...(result.kind ? { kind: result.kind } : {}),
    });
  };

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('check'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Ensure a checkbox/radio/aria-checked control is checked — JSON envelope {checked, changed, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      await runCheckCommand(page, target, opts ?? {}, true);
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('uncheck'))
      .argument('[target]', 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Ensure a checkbox/aria-checked control is unchecked — JSON envelope {checked, changed, target, matches_n}'),
  )
    .action(browserAction(async (page, target, opts) => {
      await runCheckCommand(page, target, opts ?? {}, false);
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('upload'))
      .argument('[targetOrFile]', 'Numeric ref/CSS target, or first file when using --role/--name/etc.')
      .argument('[files...]', 'Local file path(s) to attach')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Attach local files to a file input — JSON envelope {uploaded, files, file_names, target, matches_n}'),
  )
    .action(browserAction(async (page, targetOrFile, files, opts) => {
      if (typeof page.uploadFiles !== 'function') throw new Error('browser upload is not supported by this browser backend');
      const hasSemantic = !!semanticLocatorFromOptions(opts ?? {});
      const target = hasSemantic ? undefined : targetOrFile;
      const resolvedTarget = await resolveWriteTargetOrPrint(page, target, opts ?? {});
      if (!resolvedTarget) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const rawFiles = hasSemantic
        ? [targetOrFile, ...(Array.isArray(files) ? files : [])].filter((value) => value !== undefined)
        : files;
      const resolvedFiles = resolveUploadFilePaths(rawFiles);
      if ('error' in resolvedFiles) {
        emitFailure(resolvedFiles.error, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const result = await page.uploadFiles(resolvedTarget, resolvedFiles.files, parsed.opts);
      emitResult(result);
    }));

  addBrowserTabOption(
    addPrefixedSemanticLocatorOptions(
      addPrefixedSemanticLocatorOptions(browser.command('drag'), 'from'),
      'to',
    )
      .argument('[source]', 'Numeric ref/CSS selector to drag from, or omit with --from-role/--from-name/etc.')
      .argument('[target]', 'Numeric ref/CSS selector to drop onto, or omit with --to-role/--to-name/etc.')
      .option('--from-nth <n>', 'When <source> is a multi-match CSS selector, pick the nth match (0-based)')
      .option('--to-nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Drag one element to another — JSON envelope {dragged, source, target, source_matches_n, target_matches_n}'),
  )
    .action(browserAction(async (page, source, target, opts) => {
      if (typeof page.drag !== 'function') throw new Error('browser drag is not supported by this browser backend');
      const resolvedSource = await resolvePrefixedWriteTargetOrPrint(page, source, opts ?? {}, 'from', 'source');
      if (!resolvedSource) return;
      const resolvedTarget = await resolvePrefixedWriteTargetOrPrint(page, target, opts ?? {}, 'to', 'target');
      if (!resolvedTarget) return;
      const from = parseResolveFlag(opts?.fromNth, '--from-nth');
      if ('error' in from) {
        emitFailure({ code: 'usage_error', message: from.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const to = parseResolveFlag(opts?.toNth, '--to-nth');
      if ('error' in to) {
        emitFailure({ code: 'usage_error', message: to.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const result = await page.drag(resolvedSource, resolvedTarget, { from: from.opts, to: to.opts });
      emitResult(result);
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('fill'))
      .argument('[targetOrText]', 'Numeric ref/CSS target, or text when using --role/--name/etc.')
      .argument('[text]', 'Text to set exactly')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Set input/textarea/contenteditable text exactly and verify the value — JSON envelope {filled, verified, text, actual}'),
  )
    .action(browserAction(async (page, targetOrText, text, opts) => {
      const resolved = await resolveWriteTargetAndValueOrPrint(page, targetOrText, text, opts ?? {}, 'text');
      if (!resolved) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const result = await page.fillText(resolved.target, resolved.value, parsed.opts);
      if (!result.verified) { emitFailure({ code: 'value_mismatch', message: 'The input did not retain the requested value.', expected: resolved.value, actual: result.actual }); return; }
      emitResult({
        filled: result.filled,
        verified: result.verified,
        target: resolved.target,
        text: resolved.value,
        actual: result.actual,
        length: result.length,
        matches_n: result.matches_n,
        match_level: result.match_level,
        ...(result.mode ? { mode: result.mode } : {}),
      });
    }));

  addBrowserTabOption(
    addSemanticLocatorOptions(browser.command('select'))
      .argument('[targetOrOption]', 'Numeric ref/CSS target, or option text when using --role/--name/etc.')
      .argument('[option]', 'Option text (or value) to select')
      .option('--nth <n>', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)')
      .description('Select dropdown option — JSON envelope {selected, target, matches_n}'),
  )
    .action(browserAction(async (page, targetOrOption, option, opts) => {
      const resolved = await resolveWriteTargetAndValueOrPrint(page, targetOrOption, option, opts ?? {}, 'option');
      if (!resolved) return;
      const parsed = nthToResolveOpts(opts?.nth);
      if ('error' in parsed) {
        emitFailure({ code: 'usage_error', message: parsed.error }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const { matches_n, match_level } = await resolveRef(page, resolved.target, parsed.opts);
      const result = await page.evaluate(selectResolvedJs(resolved.value)) as
        | { error?: string; selected?: string; available?: string[] }
        | null;
      if (result?.error) {
        // The select-specific "Not a <select>" / "Option not found" errors
        // are domain-level failures — emit a structured envelope so agents
        // can branch on code rather than scrape a log line.
        emitFailure({
          code: result.error === 'Not a <select>' ? 'not_a_select' : 'option_not_found',
          message: result.error,
          ...(result.available && { available: result.available }),
          matches_n,
        }, EXIT_CODES.GENERIC_ERROR);
        return;
      }
      emitResult({
        selected: result?.selected ?? resolved.value,
        target: resolved.target,
        matches_n,
        match_level,
      });
    }));

  addBrowserTabOption(browser.command('keys').argument('<key>', 'Key to press (Enter, Escape, Tab, Control+a)'))
    .description('Press keyboard key')
    .action(browserAction(async (page, key) => {
      await page.pressKey(key);
      emitResult(`Pressed: ${key}`);
    }));

  const browserDialog = browser
    .command('dialog')
    .description('Handle a blocking JavaScript alert/confirm/prompt dialog');

  addBrowserTabOption(browserDialog.command('accept')
    .option('--text <text>', 'Prompt text to submit for prompt() dialogs')
    .description('Accept the currently open JavaScript dialog'))
    .action(browserAction(async (page, opts?: { text?: string }) => {
      if (!page.handleJavaScriptDialog) {
        throw new Error('This browser session does not support JavaScript dialog handling');
      }
      try {
        await page.handleJavaScriptDialog(true, opts?.text);
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.toLowerCase().includes('no dialog')) {
          emitFailure({
            code: 'no_javascript_dialog',
            message: 'No JavaScript dialog is currently open.',
          }, EXIT_CODES.USAGE_ERROR);
          return;
        }
        throw err;
      }
      emitResult({ handled: true, action: 'accept', ...(opts?.text !== undefined && { text: opts.text }) });
    }));

  addBrowserTabOption(browserDialog.command('dismiss')
    .description('Dismiss the currently open JavaScript dialog'))
    .action(browserAction(async (page) => {
      if (!page.handleJavaScriptDialog) {
        throw new Error('This browser session does not support JavaScript dialog handling');
      }
      try {
        await page.handleJavaScriptDialog(false);
      } catch (err) {
        const message = getErrorMessage(err);
        if (message.toLowerCase().includes('no dialog')) {
          emitFailure({
            code: 'no_javascript_dialog',
            message: 'No JavaScript dialog is currently open.',
          }, EXIT_CODES.USAGE_ERROR);
          return;
        }
        throw err;
      }
      emitResult({ handled: true, action: 'dismiss' });
    }));

  // ── Wait commands ──

  addBrowserTabOption(browser.command('wait'))
    .argument('<type>', 'selector, text, time, xhr, or download')
    .argument('[value]', 'CSS selector, text string, seconds, XHR URL regex, or download filename/URL pattern')
    .option('--timeout <ms>', 'Timeout in milliseconds', '10000')
    .description('Wait for selector, text, time, matching XHR, or browser download (e.g. wait selector ".loaded", wait text "Success", wait time 3, wait xhr "/api/search", wait download receipt.pdf)')
    .action(browserAction(async (page, type, value, opts) => {
      const timeout = parseInt(opts.timeout, 10);
      if (type === 'time') {
        const seconds = parseFloat(value ?? '2');
        await page.wait(seconds);
        emitResult(`Waited ${seconds}s`);
      } else if (type === 'selector') {
        if (!value) { emitFailure('Missing CSS selector', EXIT_CODES.USAGE_ERROR); return; }
        await page.wait({ selector: value, timeout: timeout / 1000 });
        emitResult(`Element "${value}" appeared`);
      } else if (type === 'text') {
        if (!value) { emitFailure('Missing text', EXIT_CODES.USAGE_ERROR); return; }
        await page.wait({ text: value, timeout: timeout / 1000 });
        emitResult(`Text "${value}" appeared`);
      } else if (type === 'xhr') {
        // Poll the capture ring until an entry matches the URL regex — turns
        // the common "open page, wait N seconds, hope the data landed" idiom
        // into a deterministic barrier keyed on the API the agent actually
        // cares about. Prevents silent "empty DOM" failures on slow SPAs.
        if (!value) { emitFailure('Missing XHR URL regex', EXIT_CODES.USAGE_ERROR); return; }
        let re: RegExp;
        try { re = new RegExp(value); } catch (err) {
          emitFailure(`Invalid regex "${value}": ${err instanceof Error ? err.message : String(err)}`, EXIT_CODES.USAGE_ERROR);
          return;
        }
        const hasSessionCapture = await page.startNetworkCapture?.() ?? false;
        if (!hasSessionCapture) {
          try { await page.evaluate(NETWORK_INTERCEPTOR_JS); } catch { /* non-fatal */ }
        }
        await captureNetworkItems(page);
        const deadline = Date.now() + timeout;
        const pollMs = 400;
        let matched: BrowserNetworkItem | null = null;
        while (Date.now() < deadline && !matched) {
          const items = await captureNetworkItems(page);
          matched = items.find((e) => re.test(e.url)) ?? null;
          if (!matched) await new Promise((r) => setTimeout(r, pollMs));
        }
        if (!matched) {
          emitFailure({
            code: 'xhr_not_seen',
            message: `No captured XHR matched /${value}/ within ${timeout}ms`,
            hint: 'Check the pattern against `browser network` output; the endpoint may not have fired yet, or capture is disabled.',
          }, EXIT_CODES.GENERIC_ERROR);
          return;
        }
        emitResult({
          matched: { url: matched.url, status: matched.status, contentType: matched.ct },
        });
      } else if (type === 'download') {
        if (typeof page.waitForDownload !== 'function') {
          emitFailure({
            code: 'download_wait_unavailable',
            message: 'The active browser backend does not support download lifecycle waits.',
            hint: 'Use the Browser Bridge extension version 1.0.8 or newer, then retry the command.',
          }, EXIT_CODES.GENERIC_ERROR);
          return;
        }
        const result = await page.waitForDownload(String(value ?? ''), timeout) as BrowserDownloadWaitResult;
        if (!result.downloaded) {
          const code = result.state === 'interrupted' && result.id !== undefined ? 'download_failed' : 'download_not_seen';
          emitFailure({
            code,
            download: result,
            message: result.error ?? `No download matched "${value ?? '*'}" within ${timeout}ms`,
            hint: 'Check the pattern against the expected filename or URL; use a longer --timeout if the download starts slowly.',
          }, EXIT_CODES.GENERIC_ERROR);
          return;
        }
        emitResult(result);
      } else {
        emitFailure(`Unknown wait type "${type}". Use: selector, text, time, xhr, or download`, EXIT_CODES.USAGE_ERROR);
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
          emitFailure(`Invalid frame index "${opts.frame}". Use a 0-based index from "browser frames".`, EXIT_CODES.USAGE_ERROR);
          return;
        }
        if (!page.evaluateInFrame) {
          throw new Error('This browser session does not support frame-targeted evaluation');
        }
        result = await page.evaluateInFrame(js, frameIndex);
      } else {
        result = await page.evaluate(js);
      }
      emitResult(result);
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
        emitFailure({ code: 'invalid_chunk_size', message: `--chunk-size must be a positive integer, got "${opts.chunkSize}"` }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      const rawStart = String(opts.start ?? '0');
      if (!/^\d+$/.test(rawStart)) {
        emitFailure({ code: 'invalid_start', message: `--start must be a non-negative integer, got "${opts.start}"` }, EXIT_CODES.USAGE_ERROR);
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
        emitFailure({ code: 'extract_failed', message: 'Page returned no root element.' }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      if ('invalidSelector' in res) {
        emitFailure({ code: 'invalid_selector', message: `Selector "${selector}" is not a valid CSS selector: ${res.reason}` }, EXIT_CODES.USAGE_ERROR);
        return;
      }
      if ('notFound' in res) {
        emitFailure({ code: 'selector_not_found', message: selector ? `Selector "${selector}" matched 0 elements.` : 'Page has no body/main/article element.' }, EXIT_CODES.USAGE_ERROR);
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
      emitResult(envelope);
    }));

  // ── Network (API discovery) ──
  //
  // Default output is JSON (agent-native). Each entry carries a stable `key`
  // (GraphQL operationName or `METHOD host+pathname`) so agents can fetch
  // full bodies with `--detail <key>` even after subsequent commands.
  // Captures are persisted per browser session under ~/.opencli/cache/browser-network/.

  addBrowserTabOption(browser.command('network'))
    .option('--static', 'Include AST endpoint candidates from loaded scripts')
    .option('--detail <key>', 'Emit full body for the entry with this key')
    .option('--all', 'Include static resources (js/css/images/telemetry)')
    .option('--raw', 'Emit full bodies for every entry (skip shape preview)')
    .option('--filter <fields>', 'Comma-separated field names; keep only entries whose body shape has ALL names as path segments')
    .option('--since <duration>', 'Only include entries from the last duration (for example: 30s, 2m)')
    .option('--until <duration>', 'Only include entries older than the duration from now')
    .option('--follow', 'Continuously print new matching entries as JSON lines', false)
    .option('--failed', 'Only include failed HTTP requests (status 0 or >= 400)', false)
    .option('--max-body <chars>', 'With --detail: cap the emitted body at N chars (0 = unlimited, default)', '0')
    .option('--ttl <ms>', 'Cache TTL in ms for --detail lookups', String(DEFAULT_TTL_MS))
    .description('Capture network requests as shape previews; retrieve full bodies by key')
    .action(browserAction(async (page, opts) => {
      if (opts.static && (opts.follow || opts.detail || opts.raw || opts.filter)) {
        emitFailure({ code: 'usage_error', message: '--static cannot be combined with --follow, --detail, --raw or --filter.' });
        return;
      }
      const ttlMs = parsePositiveIntOption(opts.ttl, 'ttl', DEFAULT_TTL_MS);
      const session = getPageSession(page);
      const cacheScope = getPageScope(page);
      const hasDetail = typeof opts.detail === 'string' && opts.detail.length > 0;
      const hasFilter = typeof opts.filter === 'string';
      const sinceMs = parseDurationMs(opts.since, 'since');
      const untilMs = parseDurationMs(opts.until, 'until');
      if (sinceMs && typeof sinceMs === 'object') {
        emitNetworkError('invalid_since', sinceMs.error);
        return;
      }
      if (untilMs && typeof untilMs === 'object') {
        emitNetworkError('invalid_until', untilMs.error);
        return;
      }

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

      if (hasDetail && opts.follow) {
        emitNetworkError('invalid_args', '--follow cannot be used with --detail.');
        return;
      }

      // --detail short-circuits: read from cache only, no live capture needed.
      if (hasDetail) {
        const res = loadNetworkCache(cacheScope, { ttlMs });
        if (res.status === 'missing') {
          emitNetworkError('cache_missing', `No cached capture. Run "browser network" first (in session "${session}").`);
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
          ...(typeof entry.timestamp === 'number' ? { timestamp: toIsoTimestamp(entry.timestamp) } : {}),
          shape: inferShape(entry.body),
          body: outputBody,
          ...(entry.request ? { request: entry.request } : {}),
        };
        if (captureTruncated || transportTruncated) {
          detailEnvelope.body_truncated = true;
          detailEnvelope.body_full_size = entry.body_full_size ?? entry.size;
          detailEnvelope.body_truncation_reason = captureTruncated
            ? 'capture-limit'
            : 'max-body';
        }
        emitResult(detailEnvelope);
        return;
      }

      if (opts.follow) {
        if (!await page.startNetworkCapture?.()) {
          try { await page.evaluate(NETWORK_INTERCEPTOR_JS); } catch { /* non-fatal */ }
        }
        while (true) {
          const rawItems = await captureNetworkItems(page).catch((err) => {
            emitNetworkError('capture_failed', `Could not read network capture: ${(err as Error).message}`);
            return [];
          });
          let items = opts.all ? rawItems : filterNetworkItems(rawItems);
          items = filterByTimeWindow(items, { sinceMs, untilMs });
          if (opts.failed) items = items.filter((item) => item.status === 0 || item.status >= 400);
          const keyed = assignKeys(items);
          for (const item of keyed) {
            emitResult({
              key: item.key,
              timestamp: toIsoTimestamp(item.timestamp),
              method: item.method,
              status: item.status,
              url: item.url,
              ct: item.ct,
              size: item.size,
              ...(item.bodyTruncated ? { body_truncated: true } : {}),
            });
          }
          await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
        }
      }

      // Fresh capture path.
      let rawItems: BrowserNetworkItem[];
      try {
        rawItems = await captureNetworkItems(page);
      } catch (err) {
        emitNetworkError('capture_failed', `Could not read network capture: ${(err as Error).message}`);
        return;
      }

      let selectedRaw = filterByTimeWindow(rawItems, { sinceMs, untilMs });
      if (opts.failed) selectedRaw = selectedRaw.filter((item) => item.status === 0 || item.status >= 400);

      // The live CDP buffer is a destructive drain. Assign keys and persist
      // the selected raw batch before applying display-only MIME/static/shape
      // filters, otherwise a default call permanently destroys RSC and other
      // non-standard responses before a later --all / --detail can inspect it.
      const keyed = assignKeys(selectedRaw);
      let cacheEntries: CachedNetworkEntry[] = keyed.map((it) => ({
        key: it.key,
        url: it.url,
        method: it.method,
        status: it.status,
        size: it.size,
        ct: it.ct,
        body: it.body,
        ...(typeof it.timestamp === 'number' ? { timestamp: it.timestamp } : {}),
        ...(it.bodyTruncated ? { body_truncated: true } : {}),
        ...(it.bodyTruncated && typeof it.bodyFullSize === 'number'
          ? { body_full_size: it.bodyFullSize }
          : {}),
        ...(it.request ? { request: it.request } : {}),
      }));

      // A repeated call commonly sees an empty live batch because the first
      // call drained it. Reuse the still-fresh raw cache instead of replacing
      // it with an empty file, so `network` followed by `network --all` works.
      let reusedCache = false;
      if (rawItems.length === 0) {
        const cached = loadNetworkCache(cacheScope, { ttlMs });
        if (cached.status === 'ok' && cached.file) {
          cacheEntries = filterByTimeWindow(cached.file.entries, { sinceMs, untilMs });
          if (opts.failed) cacheEntries = cacheEntries.filter((item) => item.status === 0 || item.status >= 400);
          reusedCache = true;
        }
      }

      const displayEntries = opts.all ? cacheEntries : filterNetworkItems(cacheEntries);
      const filteredOut = (reusedCache ? cacheEntries.length : rawItems.length) - displayEntries.length;
      // Soft failure: the caller already has the data, so surface a warning
      // via the output envelope rather than erroring out the whole command.
      let cacheWarning: string | null = null;
      if (!reusedCache && rawItems.length > 0) {
        try {
          saveNetworkCache(cacheScope, cacheEntries);
        } catch (err) {
          cacheWarning = `Could not persist capture cache: ${(err as Error).message}. --detail lookups may miss this capture.`;
        }
      }

      if (opts.static) {
        const { discoverEndpoints } = await import('../browser/discover.js');
        emitResult({
          ...await discoverEndpoints(page, displayEntries, true),
          networkSource: reusedCache ? 'cache' : rawItems.length ? 'live' : 'empty',
          ...(reusedCache ? { networkSavedAt: loadNetworkCache(cacheScope, { ttlMs }).file?.savedAt } : {}),
          ...(cacheWarning ? { cacheWarning } : {}),
        });
        return;
      }

      // Pair each cache entry with its shape up front so --filter can read
      // segments without recomputing, and the --raw view can keep the full
      // body. Cache persistence above stored the unfiltered set on purpose:
      // later `--detail <key>` lookups must still see requests that the
      // current --filter narrowed out.
      const shaped = displayEntries.map((e) => ({ entry: e, shape: inferShape(e.body) }));
      const visible = filterFields
        ? shaped.filter((s) => shapeMatchesFilter(s.shape, filterFields))
        : shaped;
      const filterDropped = filterFields ? shaped.length - visible.length : 0;

      const envelope: Record<string, unknown> = {
        session,
        captured_at: new Date().toISOString(),
        count: visible.length,
        filtered_out: filteredOut,
      };
      if (reusedCache) envelope.cache_reused = true;
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
        envelope.entries = visible.map((s) => ({
          ...s.entry,
          ...(typeof s.entry.timestamp === 'number' ? { timestamp: toIsoTimestamp(s.entry.timestamp) } : {}),
        }));
      } else {
        envelope.entries = visible.map((s) => ({
          key: s.entry.key,
          method: s.entry.method,
          ...(typeof s.entry.timestamp === 'number' ? { timestamp: toIsoTimestamp(s.entry.timestamp) } : {}),
          status: s.entry.status,
          url: s.entry.url,
          ct: s.entry.ct,
          size: s.entry.size,
          shape: s.shape,
          ...(s.entry.body_truncated ? { body_truncated: true } : {}),
        }));
        envelope.detail_hint = `Run opencli browser network --detail <key> --session ${JSON.stringify(session)} for full body.`;
      }
      emitResult(envelope);
    }));

  // ── Session ──

  browser.command('close').description('Release the current browser session tab lease')
    .action(browserAction(async (page) => {
      await page.closeWindow?.();
      emitResult('Browser session tab lease released');
    }));


  function addScopeOptions(command: Command, native = false): void {
    native ||= command.name() === 'chrome';
    if (!command.commands.length) {
      if (!native) {
        command.option('--session <name>', 'Required page session');
        command.option('--window <mode>', 'Browser window mode: foreground or background');
      }
      command.option('--profile <name>', 'Chrome profile/context');
    }
    for (const child of command.commands) addScopeOptions(child, native);
  }
  addScopeOptions(browser);
  installCommanderNamespaceStructuredHelp(browser, { globalCommand: program, description: originalBrowserDescription });
  return browser;
}
