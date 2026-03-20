/**
 * CLI discovery: finds YAML/TS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers all YAML commands instantly without runtime YAML parsing.
 *    TS modules are loaded lazily only when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { type CliCommand, type InternalCliCommand, type Arg, Strategy, registerCommand } from './registry.js';
import type { IPage } from './types.js';
import { executePipeline } from './pipeline.js';
import { log } from './logger.js';
import { AdapterLoadError } from './errors.js';

/** Set of TS module paths that have been loaded */
const _loadedModules = new Set<string>();

/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export async function discoverClis(...dirs: string[]): Promise<void> {
  // Fast path: try manifest first (production / post-build)
  for (const dir of dirs) {
    const manifestPath = path.resolve(dir, '..', 'cli-manifest.json');
    try {
      await fs.promises.access(manifestPath);
      await loadFromManifest(manifestPath, dir);
      continue; // Skip filesystem scan for this directory
    } catch {
      // Fallback: runtime filesystem scan (development)
      await discoverClisFromFs(dir);
    }
  }
}

/**
 * Fast-path: register commands from pre-compiled manifest.
 * YAML pipelines are inlined — zero YAML parsing at runtime.
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(manifestPath: string, clisDir: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as any[];
    for (const entry of manifest) {
      if (entry.type === 'yaml') {
        // YAML pipelines fully inlined in manifest — register directly
        const strategy = (Strategy as any)[entry.strategy.toUpperCase()] ?? Strategy.COOKIE;
        const cmd: CliCommand = {
          site: entry.site,
          name: entry.name,
          description: entry.description ?? '',
          domain: entry.domain,
          strategy,
          browser: entry.browser,
          args: entry.args ?? [],
          columns: entry.columns,
          pipeline: entry.pipeline,
          timeoutSeconds: entry.timeout,
          source: `manifest:${entry.site}/${entry.name}`,
        };
        registerCommand(cmd);
      } else if (entry.type === 'ts' && entry.modulePath) {
        // TS adapters: register a lightweight stub.
        // The actual module is loaded lazily on first executeCommand().
        const strategy = (Strategy as any)[(entry.strategy ?? 'cookie').toUpperCase()] ?? Strategy.COOKIE;
        const modulePath = path.resolve(clisDir, entry.modulePath);
        const cmd: InternalCliCommand = {
          site: entry.site,
          name: entry.name,
          description: entry.description ?? '',
          domain: entry.domain,
          strategy,
          browser: entry.browser ?? true,
          args: entry.args ?? [],
          columns: entry.columns,
          timeoutSeconds: entry.timeout,
          source: modulePath,
          _lazy: true,
          _modulePath: modulePath,
        };
        registerCommand(cmd);
      }
    }
  } catch (err: any) {
    log.warn(`Failed to load manifest ${manifestPath}: ${err.message}`);
  }
}

/**
 * Fallback: traditional filesystem scan (used during development with tsx).
 */
async function discoverClisFromFs(dir: string): Promise<void> {
  try { await fs.promises.access(dir); } catch { return; }
  const promises: Promise<any>[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const site = entry.name;
    const siteDir = path.join(dir, site);
    const files = await fs.promises.readdir(siteDir);
    for (const file of files) {
      const filePath = path.join(siteDir, file);
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        promises.push(registerYamlCli(filePath, site));
      } else if (
        (file.endsWith('.js') && !file.endsWith('.d.js')) ||
        (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
      ) {
        promises.push(
          import(`file://${filePath}`).catch((err: any) => {
            log.warn(`Failed to load module ${filePath}: ${err.message}`);
          })
        );
      }
    }
  }
  await Promise.all(promises);
}

async function registerYamlCli(filePath: string, defaultSite: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const def = yaml.load(raw) as any;
    if (!def || typeof def !== 'object') return;

    const site = def.site ?? defaultSite;
    const name = def.name ?? path.basename(filePath, path.extname(filePath));
    const strategyStr = def.strategy ?? (def.browser === false ? 'public' : 'cookie');
    const strategy = (Strategy as any)[strategyStr.toUpperCase()] ?? Strategy.COOKIE;
    const browser = def.browser ?? (strategy !== Strategy.PUBLIC);

    const args: Arg[] = [];
    if (def.args && typeof def.args === 'object') {
      for (const [argName, argDef] of Object.entries(def.args as Record<string, any>)) {
        args.push({
          name: argName,
          type: argDef?.type ?? 'str',
          default: argDef?.default,
          required: argDef?.required ?? false,
          positional: argDef?.positional ?? false,
          help: argDef?.description ?? argDef?.help ?? '',
          choices: argDef?.choices,
        });
      }
    }

    const cmd: CliCommand = {
      site,
      name,
      description: def.description ?? '',
      domain: def.domain,
      strategy,
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeoutSeconds: def.timeout,
      source: filePath,
    };

    registerCommand(cmd);
  } catch (err: any) {
    log.warn(`Failed to load ${filePath}: ${err.message}`);
  }
}

/**
 * Validates and coerces arguments based on the command's Arg definitions.
 */
function coerceAndValidateArgs(cmdArgs: Arg[], kwargs: Record<string, any>): Record<string, any> {
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
        // Only stringent check for string/number types against choices array
        if (!argDef.choices.map(String).includes(String(coercedVal))) {
          throw new Error(`Argument "${argDef.name}" must be one of: ${argDef.choices.join(', ')}. Received: "${coercedVal}"`);
        }
      }
    } else if (argDef.default !== undefined) {
      // Set default if value is missing
      result[argDef.name] = argDef.default;
    }
  }
  return result;
}

/**
 * Execute a CLI command. Handles lazy-loading of TS modules.
 */
export async function executeCommand(
  cmd: CliCommand,
  page: IPage | null,
  rawKwargs: Record<string, any>,
  debug: boolean = false,
): Promise<any> {
  let kwargs: Record<string, any>;
  try {
    kwargs = coerceAndValidateArgs(cmd.args, rawKwargs);
  } catch (err: any) {
    // Re-throw validation errors clearly
    throw new Error(`[Argument Validation Error]\n${err.message}`);
  }

  // Lazy-load TS module on first execution
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
    // After loading, the module's cli() call will have updated the registry
    // with the real func/pipeline. Re-fetch the command.
    const { getRegistry, fullName } = await import('./registry.js');
    const updated = getRegistry().get(fullName(cmd));
    if (updated && updated.func) {
      return updated.func(page!, kwargs, debug);
    }
    if (updated && updated.pipeline) {
      return executePipeline(page, updated.pipeline, { args: kwargs, debug });
    }
  }

  if (cmd.func) {
    return cmd.func(page!, kwargs, debug);
  }
  if (cmd.pipeline) {
    return executePipeline(page, cmd.pipeline, { args: kwargs, debug });
  }
  throw new Error(`Command ${cmd.site}/${cmd.name} has no func or pipeline`);
}
