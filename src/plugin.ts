/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.opencli/plugins/<name>/.
 * Install source format: "github:user/repo"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { PLUGINS_DIR } from './discovery.js';
import { log } from './logger.js';

export interface PluginInfo {
  name: string;
  path: string;
  commands: string[];
  source?: string;
}

/**
 * Shared post-install lifecycle: npm install → host symlink → TS transpile.
 * Called by both installPlugin() and updatePlugin().
 */
function postInstallLifecycle(pluginDir: string): void {
  const pkgJsonPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;

  try {
    execFileSync('npm', ['install', '--omit=dev'], {
      cwd: pluginDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Non-fatal: npm install may fail if no real deps
  }

  // Symlink host opencli so TS plugins resolve '@jackwener/opencli/registry'
  // against the running host, not a stale npm-published version.
  linkHostOpencli(pluginDir);

  // Transpile .ts → .js via esbuild (production node can't load .ts directly).
  transpilePluginTs(pluginDir);
}

/**
 * Install a plugin from a source.
 * Currently supports "github:user/repo" format (git clone wrapper).
 */
export function installPlugin(source: string): string {
  const parsed = parseSource(source);
  if (!parsed) {
    throw new Error(
      `Invalid plugin source: "${source}"\n` +
      `Supported formats:\n` +
      `  github:user/repo\n` +
      `  https://github.com/user/repo`
    );
  }

  const { cloneUrl, name } = parsed;
  const targetDir = path.join(PLUGINS_DIR, name);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is already installed at ${targetDir}`);
  }

  // Ensure plugins directory exists
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  try {
    execFileSync('git', ['clone', '--depth', '1', cloneUrl, targetDir], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    throw new Error(`Failed to clone plugin: ${err.message}`);
  }

  postInstallLifecycle(targetDir);
  return name;
}

/**
 * Uninstall a plugin by name.
 */
export function uninstallPlugin(name: string): void {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
}

/**
 * Update a plugin by name (git pull + re-install lifecycle).
 */
export function updatePlugin(name: string): void {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }

  try {
    execFileSync('git', ['pull', '--ff-only'], {
      cwd: targetDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    throw new Error(`Failed to update plugin: ${err.message}`);
  }

  postInstallLifecycle(targetDir);
}

/**
 * List all installed plugins.
 */
export function listPlugins(): PluginInfo[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const commands = scanPluginCommands(pluginDir);
    const source = getPluginSource(pluginDir);

    plugins.push({
      name: entry.name,
      path: pluginDir,
      commands,
      source,
    });
  }

  return plugins;
}

/** Scan a plugin directory for command files */
function scanPluginCommands(dir: string): string[] {
  try {
    const files = fs.readdirSync(dir);
    const names = new Set(
      files
        .filter(f =>
          f.endsWith('.yaml') || f.endsWith('.yml') ||
          (f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')) ||
          (f.endsWith('.js') && !f.endsWith('.d.js'))
        )
        .map(f => path.basename(f, path.extname(f)))
    );
    return [...names];
  } catch {
    return [];
  }
}

/** Get git remote origin URL */
function getPluginSource(dir: string): string | undefined {
  try {
    return execSync('git config --get remote.origin.url', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Parse a plugin source string into clone URL and name */
function parseSource(source: string): { cloneUrl: string; name: string } | null {
  // github:user/repo
  const githubMatch = source.match(/^github:([\w.-]+)\/([\w.-]+)$/);
  if (githubMatch) {
    const [, user, repo] = githubMatch;
    const name = repo.replace(/^opencli-plugin-/, '');
    return {
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  // https://github.com/user/repo (or .git)
  const urlMatch = source.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (urlMatch) {
    const [, user, repo] = urlMatch;
    const name = repo.replace(/^opencli-plugin-/, '');
    return {
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  return null;
}

/**
 * Symlink the host opencli package into a plugin's node_modules.
 * This ensures TS plugins resolve '@jackwener/opencli/registry' against
 * the running host installation rather than a stale npm-published version.
 */
function linkHostOpencli(pluginDir: string): void {
  try {
    // Determine the host opencli package root from this module's location.
    // Both dev (tsx src/plugin.ts) and prod (node dist/plugin.js) are one level
    // deep, so path.dirname + '..' always gives us the package root.
    const thisFile = new URL(import.meta.url).pathname;
    const hostRoot = path.resolve(path.dirname(thisFile), '..');

    const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');

    // Remove existing (npm-installed copy or stale symlink)
    if (fs.existsSync(targetLink)) {
      fs.rmSync(targetLink, { recursive: true, force: true });
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetLink), { recursive: true });

    // Create symlink
    fs.symlinkSync(hostRoot, targetLink, 'dir');
    log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
  } catch (err: any) {
    log.warn(`Failed to link host opencli into plugin: ${err.message}`);
  }
}

/**
 * Transpile TS plugin files to JS so they work in production mode.
 * Uses esbuild from the host opencli's node_modules for fast single-file transpilation.
 */
function transpilePluginTs(pluginDir: string): void {
  try {
    // Resolve esbuild binary from the host opencli's node_modules
    const thisFile = new URL(import.meta.url).pathname;
    const hostRoot = path.resolve(path.dirname(thisFile), '..');
    const esbuildBin = path.join(hostRoot, 'node_modules', '.bin', 'esbuild');

    if (!fs.existsSync(esbuildBin)) {
      log.debug('esbuild not found in host node_modules, skipping TS transpilation');
      return;
    }

    const files = fs.readdirSync(pluginDir);
    const tsFiles = files.filter(f =>
      f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')
    );

    for (const tsFile of tsFiles) {
      const jsFile = tsFile.replace(/\.ts$/, '.js');
      const jsPath = path.join(pluginDir, jsFile);

      // Skip if .js already exists (plugin may ship pre-compiled)
      if (fs.existsSync(jsPath)) continue;

      try {
        execFileSync(esbuildBin, [tsFile, `--outfile=${jsFile}`, '--format=esm', '--platform=node'], {
          cwd: pluginDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        log.debug(`Transpiled plugin file: ${tsFile} → ${jsFile}`);
      } catch (err: any) {
        log.warn(`Failed to transpile ${tsFile}: ${err.message}`);
      }
    }
  } catch {
    // Non-fatal: skip transpilation if anything goes wrong
  }
}

export { parseSource as _parseSource };
