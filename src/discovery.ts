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
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { type CliCommand, type InternalCliCommand, type Arg, Strategy, registerCommand } from './registry.js';
import { log } from './logger.js';

/** Plugins directory: ~/.opencli/plugins/ */
export const PLUGINS_DIR = path.join(os.homedir(), '.opencli', 'plugins');

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
          navigateBefore: entry.navigateBefore,
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
          navigateBefore: entry.navigateBefore,
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
      navigateBefore: def.navigateBefore,
    };

    registerCommand(cmd);
  } catch (err: any) {
    log.warn(`Failed to load ${filePath}: ${err.message}`);
  }
}

/**
 * Discover and register plugins from ~/.opencli/plugins/.
 * Each subdirectory is treated as a plugin (site = directory name).
 * Files inside are scanned flat (no nested site subdirs).
 */
export async function discoverPlugins(): Promise<void> {
  try { await fs.promises.access(PLUGINS_DIR); } catch { return; }
  const entries = await fs.promises.readdir(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await discoverPluginDir(path.join(PLUGINS_DIR, entry.name), entry.name);
  }
}

/**
 * Flat scan: read yaml/ts files directly in a plugin directory.
 * Unlike discoverClisFromFs, this does NOT expect nested site subdirectories.
 */
async function discoverPluginDir(dir: string, site: string): Promise<void> {
  const files = await fs.promises.readdir(dir);
  const fileSet = new Set(files);
  const promises: Promise<any>[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      promises.push(registerYamlCli(filePath, site));
    } else if (file.endsWith('.js') && !file.endsWith('.d.js')) {
      promises.push(
        import(`file://${filePath}`).catch((err: any) => {
          log.warn(`Plugin ${site}/${file}: ${err.message}`);
        })
      );
    } else if (
      file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')
    ) {
      // Skip .ts if a compiled .js sibling exists (production mode can't load .ts)
      const jsFile = file.replace(/\.ts$/, '.js');
      if (fileSet.has(jsFile)) continue;
      promises.push(
        import(`file://${filePath}`).catch((err: any) => {
          log.warn(`Plugin ${site}/${file}: ${err.message}`);
        })
      );
    }
  }
  await Promise.all(promises);
}
