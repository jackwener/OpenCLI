/**
 * Command execution: validates args, manages browser sessions, runs commands.
 *
 * This is the single entry point for executing any CLI command. It handles:
 * 1. Argument validation and coercion
 * 2. Browser session lifecycle (if needed)
 * 3. Domain pre-navigation for cookie/header strategies
 * 4. Timeout enforcement
 * 5. Lazy-loading of TS modules from manifest
 * 6. Lifecycle hooks (onBeforeExecute / onAfterExecute)
 */

import { type CliCommand, type InternalCliCommand, type Arg, type CommandArgs, getRegistry, fullName } from './registry.js';
import type { IPage } from './types.js';
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { executePipeline } from './pipeline/index.js';
import { AdapterLoadError, ArgumentError, CommandExecutionError, getErrorMessage } from './errors.js';
import { isDiagnosticEnabled, collectDiagnostic, emitDiagnostic } from './diagnostic.js';
import { shouldUseBrowserSession } from './capabilityRouting.js';
import { getBrowserFactory, browserSession, runWithTimeout, DEFAULT_BROWSER_COMMAND_TIMEOUT } from './runtime.js';
import { emitHook, type HookContext } from './hooks.js';
import { log } from './logger.js';
import { isElectronApp } from './electron-apps.js';
import { probeCDP, resolveElectronEndpoint } from './launcher.js';

const _loadedModules = new Map<string, Promise<void>>();
/** Track mtime of loaded user adapter files for hot-reload in daemon mode. */
const _moduleMtimes = new Map<string, number>();
const _userClisDir = `${os.homedir()}/.opencli/clis/`;

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
          throw new AdapterLoadError(
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
      if (!page && updated.browser !== false) {
        throw new CommandExecutionError(`Command ${fullName(cmd)} requires a browser session but none was provided`);
      }
      return updated.func(page as IPage, kwargs, debug);
    }
    if (updated?.pipeline) return executePipeline(page, updated.pipeline, { args: kwargs, debug });
  }

  if (cmd.func) return cmd.func(page as IPage, kwargs, debug);
  if (cmd.pipeline) return executePipeline(page, cmd.pipeline, { args: kwargs, debug });
  throw new CommandExecutionError(
    `Command ${fullName(cmd)} has no func or pipeline`,
    'This is likely a bug in the adapter definition. Please report this issue.',
  );
}

function resolvePreNav(cmd: CliCommand): string | null {
  if (cmd.navigateBefore === false) return null;
  if (typeof cmd.navigateBefore === 'string') return cmd.navigateBefore;
  // strategy → navigateBefore expansion already happened in normalizeCommand().
  return null;
}

function ensureRequiredEnv(cmd: CliCommand): void {
  const missing = (cmd.requiredEnv ?? []).find(({ name }) => {
    const value = process.env[name];
    return value === undefined || value === null || value === '';
  });
  if (!missing) return;

  throw new CommandExecutionError(
    `Command ${fullName(cmd)} requires environment variable ${missing.name}.`,
    missing.help ?? `Set ${missing.name} before running ${fullName(cmd)}.`,
  );
}

export async function executeCommand(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
  debug: boolean = false,
  opts: { prepared?: boolean } = {},
): Promise<unknown> {
  let kwargs: CommandArgs;
  try {
    kwargs = opts.prepared ? rawKwargs : prepareCommandArgs(cmd, rawKwargs);
  } catch (err) {
    if (err instanceof ArgumentError) throw err;
    throw new ArgumentError(getErrorMessage(err));
  }

  const hookCtx: HookContext = {
    command: fullName(cmd),
    args: kwargs,
    startedAt: Date.now(),
  };
  await emitHook('onBeforeExecute', hookCtx);

  let result: unknown;
  let diagnosticEmitted = false;
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

      ensureRequiredEnv(cmd);
      const BrowserFactory = getBrowserFactory(cmd.site);
      result = await browserSession(BrowserFactory, async (page) => {
        const preNavUrl = resolvePreNav(cmd);
        if (preNavUrl) {
          // Navigate directly — the extension's handleNavigate already has a fast-path
          // that skips navigation if the tab is already at the target URL.
          // This avoids an extra exec round-trip (getCurrentUrl) on first command and
          // lets the extension create the automation window with the target URL directly
          // instead of about:blank.
          try {
            await page.goto(preNavUrl);
          } catch (err) {
            throw new CommandExecutionError(
              `Pre-navigation to ${preNavUrl} failed: ${err instanceof Error ? err.message : err}`,
              'Check that the site is reachable and the browser extension is running.',
            );
          }
        }
        // --live / OPENCLI_LIVE=1 keeps the automation window open after the
        // command finishes, so agents (or humans) can inspect the page state.
        const keepOpen = process.env.OPENCLI_LIVE === '1' || process.env.OPENCLI_LIVE === 'true';
        try {
          const result = await runWithTimeout(runCommand(cmd, page, kwargs, debug), {
            timeout: cmd.timeoutSeconds ?? DEFAULT_BROWSER_COMMAND_TIMEOUT,
            label: fullName(cmd),
          });
          // Adapter commands are one-shot — close the automation window immediately
          // instead of waiting for the 30s idle timeout.
          if (!keepOpen) await page.closeWindow?.().catch(() => {});
          return result;
        } catch (err) {
          // Collect diagnostic while page is still alive (before closing the window).
          if (isDiagnosticEnabled()) {
            const internal = cmd as InternalCliCommand;
            const ctx = await collectDiagnostic(err, internal, page);
            emitDiagnostic(ctx);
            diagnosticEmitted = true;
          }
          // Close the automation window on failure too — without this, the window
          // lingers until the extension's idle timer fires (unreliable on Windows
          // where MV3 service workers may be suspended before setTimeout triggers).
          if (!keepOpen) await page.closeWindow?.().catch(() => {});
          throw err;
        }
      }, { workspace: `site:${cmd.site}`, cdpEndpoint });
    } else {
      // Non-browser commands: apply timeout only when explicitly configured.
      const timeout = cmd.timeoutSeconds;
      if (timeout !== undefined && timeout > 0) {
        result = await runWithTimeout(runCommand(cmd, null, kwargs, debug), {
          timeout,
          label: fullName(cmd),
          hint: `Increase the adapter's timeoutSeconds setting (currently ${timeout}s)`,
        });
      } else {
        result = await runCommand(cmd, null, kwargs, debug);
      }
    }
  } catch (err) {
    // Emit diagnostic if not already emitted (browser session emits with page state;
    // this fallback covers non-browser commands and pre-session failures like BrowserConnectError).
    if (isDiagnosticEnabled() && !diagnosticEmitted) {
      const internal = cmd as InternalCliCommand;
      const ctx = await collectDiagnostic(err, internal, null);
      emitDiagnostic(ctx);
    }
    hookCtx.error = err;
    hookCtx.finishedAt = Date.now();
    await emitHook('onAfterExecute', hookCtx);
    throw err;
  }

  hookCtx.finishedAt = Date.now();
  await emitHook('onAfterExecute', hookCtx, result);
  return result;
}

export function prepareCommandArgs(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
): CommandArgs {
  const kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  cmd.validateArgs?.(kwargs);
  return kwargs;
}
