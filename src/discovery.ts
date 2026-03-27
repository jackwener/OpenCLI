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
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { type CliCommand, type InternalCliCommand, type Arg, Strategy, registerCommand } from './registry.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';
import type { ManifestEntry } from './build-manifest.js';

/** Plugins directory: ~/.opencli/plugins/ */
export const PLUGINS_DIR = path.join(os.homedir(), '.opencli', 'plugins');
/** Matches files that register commands via cli() or lifecycle hooks */
const PLUGIN_MODULE_PATTERN = /\b(?:cli|onStartup|onBeforeExecute|onAfterExecute)\s*\(/;

import { type YamlCliDefinition, parseYamlArgs } from './yaml-schema.js';

function parseStrategy(rawStrategy: string | undefined, fallback: Strategy = Strategy.COOKIE): Strategy {
  if (!rawStrategy) return fallback;
  const key = rawStrategy.toUpperCase() as keyof typeof Strategy;
  return Strategy[key] ?? fallback;
}

import { isRecord } from './utils.js';

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
      const loaded = await loadFromManifest(manifestPath, dir);
      if (loaded) continue; // Skip filesystem scan only when manifest is usable
    } catch {
      // Fall through to filesystem scan
    }
    await discoverClisFromFs(dir);
  }
}

/**
 * Fast-path: register commands from pre-compiled manifest.
 * YAML pipelines are inlined — zero YAML parsing at runtime.
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(manifestPath: string, clisDir: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as ManifestEntry[];
    for (const entry of manifest) {
      if (entry.type === 'yaml') {
        // YAML pipelines fully inlined in manifest — register directly
        const strategy = parseStrategy(entry.strategy);
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
          deprecated: entry.deprecated,
          replacedBy: entry.replacedBy,
          navigateBefore: entry.navigateBefore,
        };
        registerCommand(cmd);
      } else if (entry.type === 'ts' && entry.modulePath) {
        // TS adapters: register a lightweight stub.
        // The actual module is loaded lazily on first executeCommand().
        const strategy = parseStrategy(entry.strategy ?? 'cookie');
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
          deprecated: entry.deprecated,
          replacedBy: entry.replacedBy,
          navigateBefore: entry.navigateBefore,
          _lazy: true,
          _modulePath: modulePath,
        };
        registerCommand(cmd);
      }
    }
    return true;
  } catch (err) {
    log.warn(`Failed to load manifest ${manifestPath}: ${getErrorMessage(err)}`);
    return false;
  }
}

/**
 * Fallback: traditional filesystem scan (used during development with tsx).
 */
async function discoverClisFromFs(dir: string): Promise<void> {
  try { await fs.promises.access(dir); } catch { return; }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  const sitePromises = entries
    .filter(entry => entry.isDirectory())
    .map(async (entry) => {
      const site = entry.name;
      const siteDir = path.join(dir, site);
      const files = await fs.promises.readdir(siteDir);
      await Promise.all(files.map(async (file) => {
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          await registerYamlCli(filePath, site);
        } else if (
          (file.endsWith('.js') && !file.endsWith('.d.js')) ||
          (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts'))
        ) {
          if (!(await isCliModule(filePath))) return;
          await import(pathToFileURL(filePath).href).catch((err) => {
            log.warn(`Failed to load module ${filePath}: ${getErrorMessage(err)}`);
          });
        }
      }));
    });
  await Promise.all(sitePromises);
}

async function registerYamlCli(filePath: string, defaultSite: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const def = yaml.load(raw) as YamlCliDefinition | null;
    if (!isRecord(def)) return;
    const cliDef = def as YamlCliDefinition;

    const site = cliDef.site ?? defaultSite;
    const name = cliDef.name ?? path.basename(filePath, path.extname(filePath));
    const strategyStr = cliDef.strategy ?? (cliDef.browser === false ? 'public' : 'cookie');
    const strategy = parseStrategy(strategyStr);
    const browser = cliDef.browser ?? (strategy !== Strategy.PUBLIC);

    const args = parseYamlArgs(cliDef.args);

    const cmd: CliCommand = {
      site,
      name,
      description: cliDef.description ?? '',
      domain: cliDef.domain,
      strategy,
      browser,
      args,
      columns: cliDef.columns,
      pipeline: cliDef.pipeline,
      timeoutSeconds: cliDef.timeout,
      source: filePath,
      deprecated: (cliDef as Record<string, unknown>).deprecated as boolean | string | undefined,
      replacedBy: (cliDef as Record<string, unknown>).replacedBy as string | undefined,
      navigateBefore: cliDef.navigateBefore,
    };

    registerCommand(cmd);
  } catch (err) {
    log.warn(`Failed to load ${filePath}: ${getErrorMessage(err)}`);
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
  await Promise.all(entries.map(async (entry) => {
    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    if (!(await isDiscoverablePluginDir(entry, pluginDir))) return;
    await discoverPluginDir(pluginDir, entry.name);
  }));
}

/**
 * Flat scan: read yaml/ts files directly in a plugin directory.
 * Unlike discoverClisFromFs, this does NOT expect nested site subdirectories.
 */
async function discoverPluginDir(dir: string, site: string): Promise<void> {
  const files = await fs.promises.readdir(dir);
  const fileSet = new Set(files);
  await Promise.all(files.map(async (file) => {
    const filePath = path.join(dir, file);
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      await registerYamlCli(filePath, site);
    } else if (file.endsWith('.js') && !file.endsWith('.d.js')) {
      if (!(await isCliModule(filePath))) return;
      await import(pathToFileURL(filePath).href).catch((err) => {
        log.warn(`Plugin ${site}/${file}: ${getErrorMessage(err)}`);
      });
    } else if (
      file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')
    ) {
      const jsFile = file.replace(/\.ts$/, '.js');
      // Prefer compiled .js — skip the .ts source file
      if (fileSet.has(jsFile)) return;
      // No compiled .js found — cannot import raw .ts in production Node.js.
      // This typically means esbuild transpilation failed during plugin install.
      log.warn(
        `Plugin ${site}/${file}: no compiled .js found. ` +
        `Run "opencli plugin update ${site}" to re-transpile, or install esbuild.`
      );
    }
  }));
}

async function isCliModule(filePath: string): Promise<boolean> {
  try {
    const source = await fs.promises.readFile(filePath, 'utf-8');
    return PLUGIN_MODULE_PATTERN.test(source);
  } catch (err) {
    log.warn(`Failed to inspect module ${filePath}: ${getErrorMessage(err)}`);
    return false;
  }
}

async function isDiscoverablePluginDir(entry: fs.Dirent, pluginDir: string): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;

  try {
    return (await fs.promises.stat(pluginDir)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn(`Failed to inspect plugin link ${pluginDir}: ${getErrorMessage(err)}`);
    }
    return false;
  }
}
