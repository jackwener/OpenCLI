/**
 * Command execution: validates args, manages browser sessions, runs commands.
 *
 * This is the single entry point for executing any CLI command. It handles:
 * 1. Argument validation and coercion
 * 2. Browser session lifecycle (if needed)
 * 3. Domain pre-navigation for cookie/header strategies
 * 4. Timeout enforcement
 * 5. Lazy-loading of TS modules from manifest
 */

import { type CliCommand, type InternalCliCommand, type Arg, Strategy, getRegistry, fullName } from './registry.js';
import type { IPage } from './types.js';
import { executePipeline } from './pipeline.js';
import { AdapterLoadError } from './errors.js';
import { shouldUseBrowserSession } from './capabilityRouting.js';
import { getBrowserFactory, browserSession, runWithTimeout, DEFAULT_BROWSER_COMMAND_TIMEOUT } from './runtime.js';

/** Set of TS module paths that have been loaded */
const _loadedModules = new Set<string>();

/**
 * Validates and coerces arguments based on the command's Arg definitions.
 */
export function coerceAndValidateArgs(cmdArgs: Arg[], kwargs: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...kwargs };

  for (const argDef of cmdArgs) {
    const val = result[argDef.name];
    
    // 1. Check required
    if (argDef.required && (val === undefined || val === null || val === '')) {
      throw new Error(`Argument "${argDef.name}" is required.\n${argDef.help ? `Hint: ${argDef.help}` : ''}`);
    }

    if (val !== undefined && val !== null) {
      // 2. Type coercion
      if (argDef.type === 'int' || argDef.type === 'number') {
        const num = Number(val);
        if (Number.isNaN(num)) {
          throw new Error(`Argument "${argDef.name}" must be a valid number. Received: "${val}"`);
        }
        result[argDef.name] = num;
      } else if (argDef.type === 'boolean' || argDef.type === 'bool') {
        if (typeof val === 'string') {
          const lower = val.toLowerCase();
          if (lower === 'true' || lower === '1') result[argDef.name] = true;
          else if (lower === 'false' || lower === '0') result[argDef.name] = false;
          else throw new Error(`Argument "${argDef.name}" must be a boolean (true/false). Received: "${val}"`);
        } else {
          result[argDef.name] = Boolean(val);
        }
      }

      // 3. Choices validation
      const coercedVal = result[argDef.name];
      if (argDef.choices && argDef.choices.length > 0) {
        if (!argDef.choices.map(String).includes(String(coercedVal))) {
          throw new Error(`Argument "${argDef.name}" must be one of: ${argDef.choices.join(', ')}. Received: "${coercedVal}"`);
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
  kwargs: Record<string, any>,
  debug: boolean,
): Promise<any> {
  // Lazy-load TS module on first execution (manifest fast-path)
  const internal = cmd as InternalCliCommand;
  if (internal._lazy && internal._modulePath) {
    const modulePath = internal._modulePath;
    if (!_loadedModules.has(modulePath)) {
      try {
        await import(`file://${modulePath}`);
        _loadedModules.add(modulePath);
      } catch (err: any) {
        throw new AdapterLoadError(
          `Failed to load adapter module ${modulePath}: ${err.message}`,
          'Check that the adapter file exists and has no syntax errors.',
        );
      }
    }
    // After loading, the module's cli() call will have updated the registry.
    const updated = getRegistry().get(fullName(cmd));
    if (updated?.func) return updated.func(page!, kwargs, debug);
    if (updated?.pipeline) return executePipeline(page, updated.pipeline, { args: kwargs, debug });
  }

  if (cmd.func) return cmd.func(page!, kwargs, debug);
  if (cmd.pipeline) return executePipeline(page, cmd.pipeline, { args: kwargs, debug });
  throw new Error(`Command ${fullName(cmd)} has no func or pipeline`);
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
 */
export async function executeCommand(
  cmd: CliCommand,
  rawKwargs: Record<string, any>,
  debug: boolean = false,
): Promise<any> {
  let kwargs: Record<string, any>;
  try {
    kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  } catch (err: any) {
    throw new Error(`[Argument Validation Error]\n${err.message}`);
  }

  if (shouldUseBrowserSession(cmd)) {
    const BrowserFactory = getBrowserFactory();
    return browserSession(BrowserFactory, async (page) => {
      // Pre-navigate to target domain for cookie/header context if needed.
      // Each adapter controls this via `navigateBefore` (see CliCommand docs).
      const preNavUrl = resolvePreNav(cmd);
      if (preNavUrl) {
        try { await page.goto(preNavUrl); await page.wait(2); } catch {}
      }
      return runWithTimeout(runCommand(cmd, page, kwargs, debug), {
        timeout: cmd.timeoutSeconds ?? DEFAULT_BROWSER_COMMAND_TIMEOUT,
        label: fullName(cmd),
      });
    }, { workspace: `site:${cmd.site}` });
  }

  // Non-browser commands run directly
  return runCommand(cmd, null, kwargs, debug);
}
