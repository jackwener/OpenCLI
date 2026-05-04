/**
 * CLI discovery: finds JS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers commands instantly. JS modules are loaded lazily only
 *    when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type InternalCliCommand, Strategy, registerCommand } from './registry.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';
import type { ManifestEntry } from './manifest-types.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';

/** User runtime directory: ~/.opencli */
export const USER_OPENCLI_DIR = path.join(os.homedir(), '.opencli');
/** User CLIs directory: ~/.opencli/clis */
export const USER_CLIS_DIR = path.join(USER_OPENCLI_DIR, 'clis');
/** Plugins directory: ~/.opencli/plugins/ */
export const PLUGINS_DIR = path.join(USER_OPENCLI_DIR, 'plugins');
/** Matches files that register commands via cli() or lifecycle hooks */
const PLUGIN_MODULE_PATTERN = /\b(?:cli|onStartup|onBeforeExecute|onAfterExecute)\s*\(/;

function parseStrategy(rawStrategy: string | undefined, fallback: Strategy = Strategy.COOKIE): Strategy {
  if (!rawStrategy) return fallback;
  const key = rawStrategy.toUpperCase() as keyof typeof Strategy;
  return Strategy[key] ?? fallback;
}

const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));

/**
 * Ensure ~/.opencli/node_modules/@jackwener/opencli symlink exists so that
 * user CLIs in ~/.opencli/clis/ can `import { cli } from '@jackwener/opencli/registry'`.
 *
 * This is the sole resolution mechanism — adapters use package exports
 * (e.g. `@jackwener/opencli/registry`, `@jackwener/opencli/errors`) and
 * Node.js resolves them through this symlink.
 */
export async function ensureUserCliCompatShims(baseDir: string = USER_OPENCLI_DIR): Promise<void> {
  await fs.promises.mkdir(baseDir, { recursive: true });

  // package.json for ESM resolution in ~/.opencli/
  const pkgJsonPath = path.join(baseDir, 'package.json');
  const pkgJsonContent = `${JSON.stringify({ name: 'opencli-user-runtime', private: true, type: 'module' }, null, 2)}\n`;
  try {
    const existing = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    if (existing !== pkgJsonContent) await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  } catch {
    await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  }

  // Create node_modules/@jackwener/opencli symlink pointing to the installed package root.
  const opencliRoot = PACKAGE_ROOT;
  const symlinkDir = path.join(baseDir, 'node_modules', '@jackwener');
  const symlinkPath = path.join(symlinkDir, 'opencli');
  try {
    let needsUpdate = true;
    try {
      const existing = await fs.promises.readlink(symlinkPath);
      if (existing === opencliRoot) needsUpdate = false;
    } catch { /* doesn't exist */ }
    if (needsUpdate) {
      await fs.promises.mkdir(symlinkDir, { recursive: true });
      try { await fs.promises.rm(symlinkPath, { recursive: true, force: true }); } catch { /* doesn't exist */ }
      const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.promises.symlink(opencliRoot, symlinkPath, symlinkType);
    }
  } catch (err) {
    log.warn(`Could not create symlink at ${symlinkPath}: ${getErrorMessage(err)}`);
  }
}

/**
 * Ensure the user adapters directory exists.
 *
 * With smart sync, ~/.opencli/clis/ only holds files that differ from the
 * package baseline (upstream-synced cache + autofix output + user overrides).
 * Built-in adapters are loaded directly from the installed package.
 */
export async function ensureUserAdapters(): Promise<void> {
  await fs.promises.mkdir(USER_CLIS_DIR, { recursive: true });
}

/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export async function discoverClis(...dirs: string[]): Promise<void> {
  // Fast path: try manifest first (production / post-build)
  for (const dir of dirs) {
    const manifestPath = getCliManifestPath(dir);
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
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(manifestPath: string, clisDir: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as ManifestEntry[];
    for (const entry of manifest) {
      if (!entry.modulePath) continue;
      const modulePath = path.resolve(clisDir, entry.modulePath);
      const cmd: InternalCliCommand = {
        site: entry.site,
        name: entry.name,
        aliases: entry.aliases,
        description: entry.description ?? '',
        access: entry.access,
        example: entry.example,
        domain: entry.domain,
        strategy: parseStrategy(entry.strategy),
        browser: entry.browser,
        args: entry.args ?? [],
        columns: entry.columns,
        pipeline: entry.pipeline,
        timeoutSeconds: entry.timeout,
        source: entry.sourceFile ? path.resolve(clisDir, entry.sourceFile) : modulePath,
        deprecated: entry.deprecated,
        replacedBy: entry.replacedBy,
        navigateBefore: entry.navigateBefore,
        _lazy: true,
        _modulePath: modulePath,
      };
      // normalizeCommand inside registerCommand handles strategy → browser/navigateBefore
      registerCommand(cmd);
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
          log.warn(`Ignoring YAML adapter ${filePath} — YAML format is no longer supported. Convert to JavaScript using cli() from '@jackwener/opencli/registry'.`);
          return;
        }
        if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
          log.warn(`Ignoring TypeScript adapter ${filePath} — .ts adapters are no longer loaded. Rename to .js or convert to JavaScript.`);
          return;
        }
        if (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js')) {
          if (!(await isCliModule(filePath))) return;
          await import(pathToFileURL(filePath).href).catch((err) => {
            log.warn(`Failed to load module ${filePath}: ${getErrorMessage(err)}`);
          });
        }
      }));
    });
  await Promise.all(sitePromises);
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
 * Flat scan: read ts/js files directly in a plugin directory.
 * Unlike discoverClisFromFs, this does NOT expect nested site subdirectories.
 */
async function discoverPluginDir(dir: string, site: string): Promise<void> {
  const files = await fs.promises.readdir(dir);
  const fileSet = new Set(files);
  await Promise.all(files.map(async (file) => {
    const filePath = path.join(dir, file);
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      log.warn(`Ignoring YAML plugin ${filePath} — YAML format is no longer supported. Convert to JavaScript using cli() from '@jackwener/opencli/registry'.`);
      return;
    }
    if (file.endsWith('.js') && !file.endsWith('.d.js')) {
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
