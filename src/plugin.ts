/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.opencli/plugins/<name>/.
 * Install source format: "github:user/repo"
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLUGINS_DIR } from './discovery.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';

const isWindows = process.platform === 'win32';

/** Get home directory, respecting HOME environment variable for test isolation. */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Path to the lock file that tracks installed plugin versions. */
export function getLockFilePath(): string {
  return path.join(getHomeDir(), '.opencli', 'plugins.lock.json');
}

// Legacy const for backward compatibility (computed at load time)
export const LOCK_FILE = path.join(os.homedir(), '.opencli', 'plugins.lock.json');

export interface LockEntry {
  source: string;
  commitHash: string;
  installedAt: string;
  updatedAt?: string;
}

export interface PluginInfo {
  name: string;
  path: string;
  commands: string[];
  source?: string;
  version?: string;
  installedAt?: string;
}

// ── Validation helpers ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Lock file helpers ───────────────────────────────────────────────────────

export function readLockFile(): Record<string, LockEntry> {
  try {
    const raw = fs.readFileSync(getLockFilePath(), 'utf-8');
    return JSON.parse(raw) as Record<string, LockEntry>;
  } catch {
    return {};
  }
}

export function writeLockFile(lock: Record<string, LockEntry>): void {
  const lockPath = getLockFilePath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

/** Get the HEAD commit hash of a git repo directory. */
export function getCommitHash(dir: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Validate that a downloaded plugin directory is a structurally valid plugin.
 * Checks for at least one command file (.yaml, .yml, .ts, .js) and a valid
 * package.json if it contains .ts files.
 */
export function validatePluginStructure(pluginDir: string): ValidationResult {
  const errors: string[] = [];
  
  if (!fs.existsSync(pluginDir)) {
    return { valid: false, errors: ['Plugin directory does not exist'] };
  }

  const files = fs.readdirSync(pluginDir);
  const hasYaml = files.some(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const hasTs = files.some(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'));
  const hasJs = files.some(f => f.endsWith('.js') && !f.endsWith('.d.js'));

  if (!hasYaml && !hasTs && !hasJs) {
    errors.push(`No command files found in plugin directory. A plugin must contain at least one .yaml, .ts, or .js command file.`);
  }

  if (hasTs) {
    const pkgJsonPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      errors.push(`Plugin contains .ts files but no package.json. A package.json with "type": "module" and "@jackwener/opencli" peer dependency is required for TS plugins.`);
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkg.type !== 'module') {
          errors.push(`Plugin package.json must have "type": "module" for TypeScript plugins.`);
        }
      } catch {
        errors.push(`Plugin package.json is malformed or invalid JSON.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
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
      ...(isWindows && { shell: true }),
    });
  } catch (err) {
    console.error(`[plugin] npm install failed in ${pluginDir}: ${err instanceof Error ? err.message : err}`);
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
  } catch (err) {
    throw new Error(`Failed to clone plugin: ${getErrorMessage(err)}`);
  }

  const validation = validatePluginStructure(targetDir);
  if (!validation.valid) {
    // If validation fails, clean up the cloned directory and abort
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(targetDir);

  const commitHash = getCommitHash(targetDir);
  if (commitHash) {
    const lock = readLockFile();
    lock[name] = {
      source: cloneUrl,
      commitHash,
      installedAt: new Date().toISOString(),
    };
    writeLockFile(lock);
  }

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

  const lock = readLockFile();
  if (lock[name]) {
    delete lock[name];
    writeLockFile(lock);
  }
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
  } catch (err) {
    throw new Error(`Failed to update plugin: ${getErrorMessage(err)}`);
  }

  const validation = validatePluginStructure(targetDir);
  if (!validation.valid) {
    log.warn(`Plugin "${name}" updated, but structure is now invalid:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(targetDir);

  const commitHash = getCommitHash(targetDir);
  if (commitHash) {
    const lock = readLockFile();
    const existing = lock[name];
    lock[name] = {
      source: existing?.source ?? getPluginSource(targetDir) ?? '',
      commitHash,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeLockFile(lock);
  }
}

export interface UpdateResult {
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Update all installed plugins.
 * Continues even if individual plugin updates fail.
 */
export function updateAllPlugins(): UpdateResult[] {
  return listPlugins().map((plugin): UpdateResult => {
    try {
      updatePlugin(plugin.name);
      return { name: plugin.name, success: true };
    } catch (err) {
      return {
        name: plugin.name,
        success: false,
        error: getErrorMessage(err),
      };
    }
  });
}

/**
 * List all installed plugins.
 */
export function listPlugins(): PluginInfo[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const lock = readLockFile();
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const commands = scanPluginCommands(pluginDir);
    const source = getPluginSource(pluginDir);
    const lockEntry = lock[entry.name];

    plugins.push({
      name: entry.name,
      path: pluginDir,
      commands,
      source,
      version: lockEntry?.commitHash?.slice(0, 7),
      installedAt: lockEntry?.installedAt,
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
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
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
    const thisFile = fileURLToPath(import.meta.url);
    const hostRoot = path.resolve(path.dirname(thisFile), '..');

    const targetLink = path.join(pluginDir, 'node_modules', '@jackwener', 'opencli');

    // Remove existing (npm-installed copy or stale symlink)
    if (fs.existsSync(targetLink)) {
      fs.rmSync(targetLink, { recursive: true, force: true });
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(targetLink), { recursive: true });

    // Use 'junction' on Windows (doesn't require admin privileges),
    // 'dir' symlink on other platforms.
    const linkType = isWindows ? 'junction' : 'dir';
    fs.symlinkSync(hostRoot, targetLink, linkType);
    log.debug(`Linked host opencli into plugin: ${targetLink} → ${hostRoot}`);
  } catch (err) {
    log.warn(`Failed to link host opencli into plugin: ${getErrorMessage(err)}`);
  }
}

/**
 * Resolve the path to the esbuild CLI executable with fallback strategies.
 */
export function resolveEsbuildBin(): string | null {
  const thisFile = fileURLToPath(import.meta.url);
  const hostRoot = path.resolve(path.dirname(thisFile), '..');

  // Strategy 1 (Windows): prefer the .cmd wrapper which is executable via shell
  if (isWindows) {
    const cmdPath = path.join(hostRoot, 'node_modules', '.bin', 'esbuild.cmd');
    if (fs.existsSync(cmdPath)) {
      return cmdPath;
    }
  }

  // Strategy 2: resolve esbuild binary via import.meta.resolve
  // (On Unix, shebang scripts are directly executable; on Windows they are not,
  //  so this strategy is skipped on Windows in favour of the .cmd wrapper above.)
  if (!isWindows) {
    try {
      const pkgUrl = import.meta.resolve('esbuild/package.json');
      if (pkgUrl.startsWith('file://')) {
        const pkgPath = fileURLToPath(pkgUrl);
        const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgRaw);
        if (pkg.bin && typeof pkg.bin === 'object' && pkg.bin.esbuild) {
          const binPath = path.resolve(path.dirname(pkgPath), pkg.bin.esbuild);
          if (fs.existsSync(binPath)) return binPath;
        } else if (typeof pkg.bin === 'string') {
          const binPath = path.resolve(path.dirname(pkgPath), pkg.bin);
          if (fs.existsSync(binPath)) return binPath;
        }
      }
    } catch {
      // ignore package resolution failures
    }
  }

  // Strategy 3: fallback to node_modules/.bin/esbuild (Unix)
  const binFallback = path.join(hostRoot, 'node_modules', '.bin', 'esbuild');
  if (fs.existsSync(binFallback)) {
    return binFallback;
  }

  // Strategy 4: global esbuild in PATH
  try {
    const lookupCmd = isWindows ? 'where esbuild' : 'which esbuild';
    // `where` on Windows may return multiple lines; take only the first match.
    const globalBin = execSync(lookupCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0].trim();
    if (globalBin && fs.existsSync(globalBin)) {
      return globalBin;
    }
  } catch {
    // ignore PATH lookup failures
  }

  return null;
}

/**
 * Transpile TS plugin files to JS so they work in production mode.
 * Uses esbuild from the host opencli's node_modules for fast single-file transpilation.
 */
function transpilePluginTs(pluginDir: string): void {
  try {
    const esbuildBin = resolveEsbuildBin();

    if (!esbuildBin) {
      log.debug('esbuild not found in host node_modules, via resolve, or in PATH, skipping TS transpilation');
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
          ...(isWindows && { shell: true }),
        });
        log.debug(`Transpiled plugin file: ${tsFile} → ${jsFile}`);
      } catch (err) {
        log.warn(`Failed to transpile ${tsFile}: ${getErrorMessage(err)}`);
      }
    }
  } catch {
    // Non-fatal: skip transpilation if anything goes wrong
  }
}

export {
  resolveEsbuildBin as _resolveEsbuildBin,
  getCommitHash as _getCommitHash,
  parseSource as _parseSource,
  readLockFile as _readLockFile,
  updateAllPlugins as _updateAllPlugins,
  validatePluginStructure as _validatePluginStructure,
  writeLockFile as _writeLockFile,
};
