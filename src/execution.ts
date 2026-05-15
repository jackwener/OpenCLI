/**
 * Command execution: validates args, manages browser sessions, runs commands.
 *
 * This is the single entry point for executing any CLI command. It handles:
 * 1. Argument validation and coercion
 * 2. Browser session lifecycle (if needed)
 * 3. Domain pre-navigation for cookie strategies
 * 4. Timeout enforcement
 * 5. Lazy-loading of TS modules from manifest
 * 6. Lifecycle hooks (onBeforeExecute / onAfterExecute)
 */

import {
  type BrowserCliCommand,
  type CliCommand,
  type InternalCliCommand,
  type SiteSessionMode,
  type Arg,
  type CommandArgs,
  getRegistry,
  fullName,
} from './registry.js';
import type { IPage } from './types.js';
import { pathToFileURL } from 'node:url';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { executePipeline } from './pipeline/index.js';
import { adapterLoadError, ArgumentError, CommandExecutionError, attachTraceReceipt, getErrorMessage } from './errors.js';
import { shouldUseBrowserSession } from './capabilityRouting.js';
import { getBrowserFactory, browserSession, runWithTimeout, DEFAULT_BROWSER_COMMAND_TIMEOUT, type BrowserWindowMode } from './runtime.js';
import { resolveProfileContextId } from './browser/profile.js';
import { emitHook, type HookContext } from './hooks.js';
import { log } from './logger.js';
import { isElectronApp } from './electron-apps.js';
import { probeCDP, resolveElectronEndpoint } from './launcher.js';
import { ObservationSession, exportObservationSession, type ObservationExportResult, type ObservationExportStatus } from './observation/index.js';
import { resolveAdapterSourcePath } from './adapter-source.js';

const _loadedModules = new Map<string, Promise<void>>();
/** Track mtime of loaded user adapter files for hot-reload in daemon mode. */
const _moduleMtimes = new Map<string, number>();
const _userClisDir = `${os.homedir()}/.opencli/clis/`;

type TraceMode = 'off' | 'on' | 'retain-on-failure';

function normalizeTraceMode(raw: unknown): TraceMode {
  if (raw === undefined || raw === null || raw === '' || raw === 'off') return 'off';
  if (raw === 'on' || raw === 'retain-on-failure') return raw;
  throw new ArgumentError(`--trace must be one of: off, on, retain-on-failure. Received: "${String(raw)}"`);
}

export function coerceAndValidateArgs(cmdArgs: Arg[], kwargs: CommandArgs): CommandArgs {
  const result: CommandArgs = { ...kwargs };

  for (const argDef of cmdArgs) {
    const val = result[argDef.name];

    if (argDef.required && (val === undefined || val === null || val === '')) {
      throw new ArgumentError(
        `Argument "${argDef.name}" is required.`,
        argDef.help ?? `Provide a value for --${argDef.name}`,
      );
    }

    if (val !== undefined && val !== null) {
      if (argDef.type === 'int' || argDef.type === 'number') {
        const num = Number(val);
        if (Number.isNaN(num)) {
          throw new ArgumentError(`Argument "${argDef.name}" must be a valid number. Received: "${val}"`);
        }
        result[argDef.name] = num;
      } else if (argDef.type === 'boolean' || argDef.type === 'bool') {
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          if (lower === 'true' || lower === '1') result[argDef.name] = true;
          else if (lower === 'false' || lower === '0') result[argDef.name] = false;
          else throw new ArgumentError(`Argument "${argDef.name}" must be a boolean (true/false). Received: "${val}"`);
        } else {
          result[argDef.name] = Boolean(val);
        }
      }

      const coercedVal = result[argDef.name];
      if (argDef.choices && argDef.choices.length > 0) {
        if (!argDef.choices.map(String).includes(String(coercedVal))) {
          throw new ArgumentError(`Argument "${argDef.name}" must be one of: ${argDef.choices.join(', ')}. Received: "${coercedVal}"`);
        }
      }
    } else if (argDef.default !== undefined) {
      result[argDef.name] = argDef.default;
    }
  }
  return result;
}

async function runCommand(
  cmd: CliCommand,
  page: IPage | null,
  kwargs: CommandArgs,
  debug: boolean,
): Promise<unknown> {
  const internal = cmd as InternalCliCommand;
  if (internal._lazy && internal._modulePath) {
    const modulePath = internal._modulePath;
    // Hot-reload: if a user adapter's file has changed on disk, invalidate cache
    const isUserAdapter = modulePath.startsWith(_userClisDir);
    if (isUserAdapter && _loadedModules.has(modulePath)) {
      try {
        const stat = fs.statSync(modulePath);
        const prevMtime = _moduleMtimes.get(modulePath);
        if (prevMtime !== undefined && stat.mtimeMs !== prevMtime) {
          _loadedModules.delete(modulePath);
          _moduleMtimes.delete(modulePath);
        }
      } catch { /* file may have been deleted; let import below handle it */ }
    }
    if (!_loadedModules.has(modulePath)) {
      const url = pathToFileURL(modulePath).href;
      const importUrl = _moduleMtimes.has(modulePath) ? `${url}?t=${Date.now()}` : url;
      const loadPromise = import(importUrl).then(
        () => {
          try { _moduleMtimes.set(modulePath, fs.statSync(modulePath).mtimeMs); } catch {}
        },
        (err) => {
          _loadedModules.delete(modulePath);
          throw adapterLoadError(
            `Failed to load adapter module ${modulePath}: ${getErrorMessage(err)}`,
            'Check that the adapter file exists and has no syntax errors.',
          );
        },
      );
      _loadedModules.set(modulePath, loadPromise);
    }
    await _loadedModules.get(modulePath);

    const updated = getRegistry().get(fullName(cmd));
    if (updated?.func) {
      return runCommandFunc(updated, page, kwargs, debug);
    }
    if (updated?.pipeline) return executePipeline(page, updated.pipeline, { args: kwargs, debug });
  }

  if (cmd.func) return runCommandFunc(cmd, page, kwargs, debug);
  if (cmd.pipeline) return executePipeline(page, cmd.pipeline, { args: kwargs, debug });
  throw new CommandExecutionError(
    `Command ${fullName(cmd)} has no func or pipeline`,
    'This is likely a bug in the adapter definition. Please report this issue.',
  );
}

function runCommandFunc(cmd: CliCommand, page: IPage | null, kwargs: CommandArgs, debug: boolean): Promise<unknown> {
  if (cmd.browser === false) return cmd.func!(kwargs, debug);
  if (!page) {
    throw new CommandExecutionError(`Command ${fullName(cmd)} requires a browser session but none was provided`);
  }
  return (cmd as BrowserCliCommand).func!(page, kwargs, debug);
}

function resolvePreNav(cmd: CliCommand): string | null {
  if (cmd.navigateBefore === false) return null;
  if (typeof cmd.navigateBefore === 'string') return cmd.navigateBefore;
  // strategy → navigateBefore expansion already happened in normalizeCommand().
  return null;
}

function urlMatchesDomain(url: string | null | undefined, domain: string | undefined): boolean {
  if (!url || !domain) return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function isDomainRootPreNav(preNavUrl: string, domain: string | undefined): boolean {
  if (!domain) return false;
  try {
    const parsed = new URL(preNavUrl);
    const hostnameMatches = parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
    const rootPath = parsed.pathname === '' || parsed.pathname === '/';
    return hostnameMatches && rootPath && parsed.search === '' && parsed.hash === '';
  } catch {
    return false;
  }
}

async function shouldRunPreNav(cmd: CliCommand, page: IPage, siteSession: SiteSessionMode, preNavUrl: string): Promise<boolean> {
  if (siteSession !== 'persistent' || !cmd.domain) return true;
  if (!isDomainRootPreNav(preNavUrl, cmd.domain)) return true;
  const currentUrl = await page.getCurrentUrl?.().catch(() => null);
  return !urlMatchesDomain(currentUrl, cmd.domain);
}

export async function executeCommand(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
  debug: boolean = false,
  opts: {
    prepared?: boolean;
    profile?: string;
    trace?: string;
    keepTab?: string;
    windowMode?: string;
    siteSession?: string;
    onTraceExport?: (trace: ObservationExportResult) => void;
  } = {},
): Promise<unknown> {
  let kwargs: CommandArgs;
  try {
    kwargs = opts.prepared ? rawKwargs : prepareCommandArgs(cmd, rawKwargs);
  } catch (err) {
    if (err instanceof ArgumentError) throw err;
    throw new ArgumentError(getErrorMessage(err));
  }

  const userTimeoutSec = readUserTimeoutSeconds(cmd, kwargs);
  const traceMode = normalizeTraceMode(opts.trace);

  const hookCtx: HookContext = {
    command: fullName(cmd),
    args: kwargs,
    startedAt: Date.now(),
  };
  await emitHook('onBeforeExecute', hookCtx);

  let result: unknown;
  try {
    if (shouldUseBrowserSession(cmd)) {
      const electron = isElectronApp(cmd.site);
      let cdpEndpoint: string | undefined;

      if (electron) {
        // Electron apps: respect manual endpoint override, then try auto-detect
        const manualEndpoint = process.env.OPENCLI_CDP_ENDPOINT;
        if (manualEndpoint) {
          const port = Number(new URL(manualEndpoint).port);
          if (!await probeCDP(port)) {
            throw new CommandExecutionError(
              `CDP not reachable at ${manualEndpoint}`,
              'Check that the app is running with --remote-debugging-port and the endpoint is correct.',
            );
          }
          cdpEndpoint = manualEndpoint;
        } else {
          cdpEndpoint = await resolveElectronEndpoint(cmd.site);
        }
      }

      const BrowserFactory = getBrowserFactory(cmd.site);
      const contextId = resolveProfileContextId(opts.profile);
      const internal = cmd as InternalCliCommand;
      const siteSession = resolveSiteSession(cmd, opts.siteSession);
      const session = resolveAdapterBrowserSession(cmd, siteSession);
      const keepTab = resolveKeepTab(siteSession, opts.keepTab);
      const windowMode = resolveBrowserWindowMode('background', opts.windowMode);
      result = await browserSession(BrowserFactory, async (page) => {
        const observation = traceMode === 'off'
          ? null
          : new ObservationSession({
            scope: {
              contextId,
              session,
              target: page.getActivePage?.(),
              site: cmd.site,
              command: fullName(cmd),
              adapterSourcePath: resolveAdapterSourcePath(internal),
            },
          });
        if (observation) {
          observation.record({
            stream: 'action',
            name: 'command',
            phase: 'start',
            data: { args: kwargs },
          });
          await page.startNetworkCapture?.().catch(() => false);
        }
        const preNavUrl = resolvePreNav(cmd);
        if (preNavUrl && await shouldRunPreNav(cmd, page, siteSession, preNavUrl)) {
          observation?.record({
            stream: 'action',
            name: 'pre_navigate',
            phase: 'start',
            data: { url: preNavUrl },
          });
          // Navigate directly — the extension's handleNavigate already has a fast-path
          // that skips navigation if the tab is already at the target URL.
          // This avoids an extra exec round-trip (getCurrentUrl) on first command and
          // lets the extension create the automation window with the target URL directly
          // instead of about:blank.
          try {
            await page.goto(preNavUrl);
            observation?.record({
              stream: 'action',
              name: 'pre_navigate',
              phase: 'end',
              data: { url: preNavUrl },
            });
          } catch (err) {
            observation?.record({
              stream: 'action',
              name: 'pre_navigate',
              phase: 'error',
              data: { url: preNavUrl, error: err instanceof Error ? err.message : String(err) },
            });
            const wrapped = new CommandExecutionError(
              `Pre-navigation to ${preNavUrl} failed: ${err instanceof Error ? err.message : err}`,
              'Check that the site is reachable and the browser extension is running.',
            );
            if (observation && (traceMode === 'on' || traceMode === 'retain-on-failure')) {
              observation.record({
                stream: 'error',
                message: wrapped.message,
                stack: wrapped.stack,
                code: wrapped.code,
                hint: wrapped.hint,
              });
              await collectObservationEvidence(observation, page).catch(() => {});
              exportTraceArtifact(observation, 'failure', wrapped, opts.onTraceExport);
            }
            throw wrapped;
          }
        }
        try {
          const browserTimeout = userTimeoutSec !== null
            ? userTimeoutSec + RUNTIME_TIMEOUT_PADDING_SECONDS
            : DEFAULT_BROWSER_COMMAND_TIMEOUT;
          const result = await runWithTimeout(runCommand(cmd, page, kwargs, debug), {
            timeout: browserTimeout,
            label: fullName(cmd),
          });
          observation?.record({
            stream: 'action',
            name: 'command',
            phase: 'end',
          });
          if (observation && traceMode === 'on') {
            await collectObservationEvidence(observation, page).catch(() => {});
            exportTraceArtifact(observation, 'success', undefined, opts.onTraceExport);
          }
          // Adapter commands are one-shot — release the current tab lease immediately
          // instead of waiting for the 30s idle timeout. The automation container
          // window stays open for reuse.
          if (!keepTab) await page.closeWindow?.().catch(() => {});
          return result;
        } catch (err) {
          if (observation) {
            observation.record({
              stream: 'action',
              name: 'command',
              phase: 'error',
              data: { error: err instanceof Error ? err.message : String(err) },
            });
            observation.record({
              stream: 'error',
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
            if (traceMode === 'on' || traceMode === 'retain-on-failure') {
              await collectObservationEvidence(observation, page).catch(() => {});
              exportTraceArtifact(observation, 'failure', err, opts.onTraceExport);
            }
          }
          // Release the tab lease on failure too — without this, the lease lingers
          // until the extension's idle timer fires (unreliable on Windows where
          // MV3 service workers may be suspended before setTimeout triggers).
          if (!keepTab) await page.closeWindow?.().catch(() => {});
          throw err;
        }
      }, { session, cdpEndpoint, contextId, windowMode, surface: 'adapter', siteSession });
    } else {
      // Non-browser commands: enforce a timeout only when the command exposes
      // a `--timeout` arg (and the resolved value is positive). Without that
      // arg there is no meaningful default — non-browser cmds are diverse
      // enough that a hard cap would do more harm than good.
      if (userTimeoutSec !== null) {
        const ceiling = userTimeoutSec + RUNTIME_TIMEOUT_PADDING_SECONDS;
        result = await runWithTimeout(runCommand(cmd, null, kwargs, debug), {
          timeout: ceiling,
          label: fullName(cmd),
          hint: `Pass a higher --timeout value (currently ${userTimeoutSec}s)`,
        });
      } else {
        result = await runCommand(cmd, null, kwargs, debug);
      }
    }
  } catch (err) {
    hookCtx.error = err;
    hookCtx.finishedAt = Date.now();
    await emitHook('onAfterExecute', hookCtx);
    throw err;
  }

  hookCtx.finishedAt = Date.now();
  await emitHook('onAfterExecute', hookCtx, result);
  return result;
}

async function collectObservationEvidence(session: ObservationSession, page: IPage): Promise<void> {
  const target = page.getActivePage?.() ?? session.scope.target;
  const [url, snapshot, networkEntries, consoleMessages, screenshot] = await Promise.all([
    page.getCurrentUrl?.().catch(() => null) ?? Promise.resolve(null),
    page.snapshot().catch(() => undefined),
    page.readNetworkCapture?.().catch(() => []) ?? Promise.resolve([]),
    page.consoleMessages('all').catch(() => []),
    page.screenshot({ format: 'png' }).catch(() => undefined),
  ]);

  if (snapshot !== undefined || url !== undefined) {
    session.record({ stream: 'state', url, target, snapshot, label: 'final' });
  }
  for (const entry of Array.isArray(networkEntries) ? networkEntries : []) {
    const record = entry as Record<string, unknown>;
    session.record({
      stream: 'network',
      url: String(record.url ?? ''),
      method: typeof record.method === 'string' ? record.method : undefined,
      status: typeof record.responseStatus === 'number' ? record.responseStatus : undefined,
      contentType: typeof record.responseContentType === 'string' ? record.responseContentType : undefined,
      size: typeof record.responseBodyFullSize === 'number' ? record.responseBodyFullSize : undefined,
      requestHeaders: record.requestHeaders as Record<string, unknown> | undefined,
      responseHeaders: record.responseHeaders as Record<string, unknown> | undefined,
      requestBody: record.requestBodyPreview,
      responseBody: record.responsePreview,
      ts: typeof record.timestamp === 'number' ? record.timestamp : undefined,
    });
  }
  for (const message of Array.isArray(consoleMessages) ? consoleMessages : []) {
    if (message && typeof message === 'object') {
      const record = message as Record<string, unknown>;
      session.record({
        stream: 'console',
        level: String(record.type ?? record.level ?? 'log'),
        text: String(record.text ?? record.message ?? ''),
        ts: typeof record.timestamp === 'number' ? record.timestamp : undefined,
      });
    } else {
      session.record({ stream: 'console', level: 'log', text: String(message) });
    }
  }
  if (typeof screenshot === 'string' && screenshot) {
    session.record({ stream: 'screenshot', format: 'png', data: screenshot, label: 'final' });
  }
}

function exportTraceArtifact(
  session: ObservationSession,
  status: ObservationExportStatus,
  error?: unknown,
  onTraceExport?: (trace: ObservationExportResult) => void,
): ObservationExportResult | undefined {
  try {
    const trace = exportObservationSession(session, { error, status });
    if (status === 'failure' && error !== undefined) {
      attachTraceReceipt(error, trace.receipt);
    } else {
      process.stderr.write(`OpenCLI trace artifact: ${trace.dir}\n`);
    }
    try {
      onTraceExport?.(trace);
    } catch (err) {
      log.warn(`[trace] Trace export callback failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return trace;
  } catch (err) {
    log.warn(`[trace] Failed to export trace artifact: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export function prepareCommandArgs(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
): CommandArgs {
  const kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  cmd.validateArgs?.(kwargs);
  return kwargs;
}

/**
 * Runtime ceiling padding (seconds) added on top of the user's `--timeout`.
 * The adapter's polling loop typically uses the full user value; the padding
 * gives us room for the adapter to return + closeWindow + trace export before
 * the runtime kills the Promise.
 */
const RUNTIME_TIMEOUT_PADDING_SECONDS = 30;

function normalizeSiteSession(raw: unknown): SiteSessionMode | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw === 'ephemeral' || raw === 'persistent') return raw;
  throw new ArgumentError(`--site-session must be one of: ephemeral, persistent. Received: "${String(raw)}"`);
}

function resolveSiteSession(cmd: CliCommand, rawOption?: unknown): SiteSessionMode {
  return normalizeSiteSession(rawOption) ?? cmd.siteSession ?? 'ephemeral';
}

function resolveAdapterBrowserSession(cmd: CliCommand, siteSession: SiteSessionMode): string {
  if (siteSession === 'persistent') return `site:${cmd.site}`;
  return `site:${cmd.site}:${crypto.randomUUID()}`;
}

function normalizeBooleanOption(name: string, raw: unknown): boolean | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ArgumentError(`${name} must be one of: true, false. Received: "${String(raw)}"`);
}

function resolveKeepTab(siteSession: SiteSessionMode, rawOption?: unknown): boolean {
  if (siteSession === 'persistent') return true;
  return normalizeBooleanOption('--keep-tab', rawOption) ?? false;
}

function normalizeWindowMode(name: string, raw: unknown): BrowserWindowMode | null {
  if (raw === undefined || raw === '') return null;
  if (raw === 'foreground' || raw === 'background') return raw;
  throw new ArgumentError(`${name} must be one of: foreground, background. Received: "${String(raw)}"`);
}

function resolveBrowserWindowMode(defaultMode: BrowserWindowMode = 'background', rawOption?: unknown): BrowserWindowMode {
  return normalizeWindowMode('--window', rawOption)
    ?? normalizeWindowMode('OPENCLI_WINDOW', process.env.OPENCLI_WINDOW)
    ?? defaultMode;
}

/**
 * Resolve the user-controllable `--timeout` arg, in seconds.
 *
 * Convention: a command opts into runtime-enforced timeouts by declaring an
 * arg named `timeout`. The arg's `default` flows through `prepareCommandArgs`
 * into `kwargs.timeout`, so by the time runtime enforcement runs, the value
 * is the merged user-supplied-or-default seconds.
 *
 * Returns the parsed positive integer (seconds), or null if the command does
 * not expose a `timeout` arg. Declaring `timeout` opts into runtime timeout
 * enforcement, so invalid values must fail upfront instead of silently
 * disabling the runtime ceiling.
 */
function readUserTimeoutSeconds(cmd: CliCommand, kwargs: CommandArgs): number | null {
  if (!cmd.args.some(a => a.name === 'timeout')) return null;
  const raw = kwargs.timeout;
  if (raw === undefined || raw === null || raw === '') {
    throw new ArgumentError(`Argument "timeout" must be a positive integer. Received: "${String(raw)}"`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ArgumentError(`Argument "timeout" must be a positive integer. Received: "${String(raw)}"`);
  }
  return parsed;
}
