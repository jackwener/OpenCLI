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

import { type CliCommand, type InternalCliCommand, type Arg, Strategy, getRegistry, fullName } from './registry.js';
import type { IPage } from './types.js';
import { pathToFileURL } from 'node:url';
import { executePipeline } from './pipeline/index.js';
import { AdapterLoadError, ArgumentError, CommandExecutionError, getErrorMessage } from './errors.js';
import { shouldUseBrowserSession } from './capabilityRouting.js';
import { getBrowserFactory, browserSession, runWithTimeout, DEFAULT_BROWSER_COMMAND_TIMEOUT } from './runtime.js';
import { emitHook, type HookContext } from './hooks.js';

/** Set of TS module paths that have been loaded */
const _loadedModules = new Set<string>();
type CommandArgs = Record<string, unknown>;


/**
 * Validates and coerces arguments based on the command's Arg definitions.
 */
export function coerceAndValidateArgs(cmdArgs: Arg[], kwargs: CommandArgs): CommandArgs {
  const result: CommandArgs = { ...kwargs };

  for (const argDef of cmdArgs) {
    const val = result[argDef.name];
    
    // 1. Check required
    if (argDef.required && (val === undefined || val === null || val === '')) {
      throw new ArgumentError(
        `Argument "${argDef.name}" is required.`,
        argDef.help ?? `Provide a value for --${argDef.name}`,
      );
    }

    if (val !== undefined && val !== null) {
      // 2. Type coercion
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

      // 3. Choices validation
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

/**
 * Run a command's func or pipeline against a page.
 */
async function runCommand(
  cmd: CliCommand,
  page: IPage | null,
  kwargs: CommandArgs,
  debug: boolean,
): Promise<unknown> {
  // Lazy-load TS module on first execution (manifest fast-path)
  const internal = cmd as InternalCliCommand;
  if (internal._lazy && internal._modulePath) {
    const modulePath = internal._modulePath;
    if (!_loadedModules.has(modulePath)) {
      try {
        await import(pathToFileURL(modulePath).href);
        _loadedModules.add(modulePath);
      } catch (err) {
        throw new AdapterLoadError(
          `Failed to load adapter module ${modulePath}: ${getErrorMessage(err)}`,
          'Check that the adapter file exists and has no syntax errors.',
        );
      }
    }
    // After loading, the module's cli() call will have updated the registry.
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

/**
 * Resolve the pre-navigation URL for a command, or null to skip.
 *
 * COOKIE/HEADER strategies need the browser on the target domain so
 * `fetch(url, { credentials: 'include' })` carries cookies.
 * Adapters that handle their own navigation set `navigateBefore: false`.
 */
function resolvePreNav(cmd: CliCommand): string | null {
  if (cmd.navigateBefore === false) return null;
  if (typeof cmd.navigateBefore === 'string') return cmd.navigateBefore;

  // Default: pre-navigate for COOKIE/HEADER strategies with a domain
  if ((cmd.strategy === Strategy.COOKIE || cmd.strategy === Strategy.HEADER) && cmd.domain) {
    return `https://${cmd.domain}`;
  }
  return null;
}

/**
 * Execute a CLI command. Automatically manages browser sessions when needed.
 *
 * This is the unified entry point — callers don't need to care about
 * whether the command requires a browser or not.
 *
 * Lifecycle hooks are emitted around execution:
 *   onBeforeExecute → command runs → onAfterExecute(result)
 */
export async function executeCommand(
  cmd: CliCommand,
  rawKwargs: CommandArgs,
  debug: boolean = false,
): Promise<unknown> {
  let kwargs: CommandArgs;
  try {
    kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  } catch (err) {
    if (err instanceof ArgumentError) throw err;
    throw new ArgumentError(getErrorMessage(err));
  }

  // Build hook context shared across onBeforeExecute and onAfterExecute
  const hookCtx: HookContext = {
    command: fullName(cmd),
    args: kwargs,
    startedAt: Date.now(),
  };
  await emitHook('onBeforeExecute', hookCtx);

  let result: unknown;

  if (shouldUseBrowserSession(cmd)) {
    const BrowserFactory = getBrowserFactory();
    result = await browserSession(BrowserFactory, async (page) => {
      // Pre-navigate to target domain for cookie/header context if needed.
      // Each adapter controls this via `navigateBefore` (see CliCommand docs).
      const preNavUrl = resolvePreNav(cmd);
      if (preNavUrl) {
        try { await page.goto(preNavUrl); await page.wait(2); } catch (err) {
          if (debug) console.error(`[pre-nav] Failed to navigate to ${preNavUrl}: ${err instanceof Error ? err.message : err}`);
        }
      }
      return runWithTimeout(runCommand(cmd, page, kwargs, debug), {
        timeout: cmd.timeoutSeconds ?? DEFAULT_BROWSER_COMMAND_TIMEOUT,
        label: fullName(cmd),
      });
    }, { workspace: `site:${cmd.site}` });
  } else {
    // Non-browser commands run directly
    result = await runCommand(cmd, null, kwargs, debug);
  }

  await emitHook('onAfterExecute', hookCtx, result);
  return result;
}

