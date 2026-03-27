/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.opencli/plugins/<name>/.
 * Monorepo clones live in ~/.opencli/monorepos/<repo-name>/.
 * Install source format: "github:user/repo", "github:user/repo/subplugin",
 * "https://github.com/user/repo", "file:///local/plugin", or a local directory path.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLUGINS_DIR } from './discovery.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';
import {
  readPluginManifest,
  isMonorepo,
  getEnabledPlugins,
  checkCompatibility,
  type PluginManifest,
} from './plugin-manifest.js';

const isWindows = process.platform === 'win32';
const LOCAL_PLUGIN_SOURCE_PREFIX = 'local:';

/** Get home directory, respecting HOME environment variable for test isolation. */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Path to the lock file that tracks installed plugin versions. */
export function getLockFilePath(): string {
  return path.join(getHomeDir(), '.opencli', 'plugins.lock.json');
}

/** Monorepo clones directory: ~/.opencli/monorepos/ */
export function getMonoreposDir(): string {
  return path.join(getHomeDir(), '.opencli', 'monorepos');
}

export interface LockEntry {
  source: string;
  commitHash: string;
  installedAt: string;
  updatedAt?: string;
  /** Present when this plugin comes from a monorepo. */
  monorepo?: {
    /** Monorepo directory name under ~/.opencli/monorepos/ */
    name: string;
    /** Relative path of this sub-plugin within the monorepo. */
    subPath: string;
  };
}

export interface PluginInfo {
  name: string;
  path: string;
  commands: string[];
  source?: string;
  version?: string;
  installedAt?: string;
  /** If from a monorepo, the monorepo name. */
  monorepoName?: string;
  /** Description from opencli-plugin.json. */
  description?: string;
}

interface ParsedSource {
  type: 'git' | 'local';
  name: string;
  subPlugin?: string;
  cloneUrl?: string;
  localPath?: string;
}

function isLocalPluginSource(source?: string): boolean {
  return typeof source === 'string' && source.startsWith(LOCAL_PLUGIN_SOURCE_PREFIX);
}

function toLocalPluginSource(pluginDir: string): string {
  return `${LOCAL_PLUGIN_SOURCE_PREFIX}${path.resolve(pluginDir)}`;
}

function resolveStoredPluginSource(lockEntry: LockEntry | undefined, pluginDir: string): string | undefined {
  return lockEntry?.source ?? getPluginSource(pluginDir);
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

/**
 * Move a directory, with EXDEV fallback.
 * fs.renameSync fails when source and destination are on different
 * filesystems (e.g. /tmp → ~/.opencli). In that case we copy then remove.
 */
type MoveDirFsOps = Pick<typeof fs, 'renameSync' | 'cpSync' | 'rmSync'>;

function moveDir(src: string, dest: string, fsOps: MoveDirFsOps = fs): void {
  try {
    fsOps.renameSync(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      try {
        fsOps.cpSync(src, dest, { recursive: true });
      } catch (copyErr) {
        try { fsOps.rmSync(dest, { recursive: true, force: true }); } catch {}
        throw copyErr;
      }
      fsOps.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

type PromoteDirFsOps = MoveDirFsOps & Pick<typeof fs, 'existsSync' | 'mkdirSync'>;

function createSiblingTempPath(dest: string, kind: 'tmp' | 'bak'): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(path.dirname(dest), `.${path.basename(dest)}.${kind}-${suffix}`);
}

/**
 * Promote a prepared staging directory into its final location.
 * The final path is only exposed after the directory has been fully prepared.
 */
function promoteDir(stagingDir: string, dest: string, fsOps: PromoteDirFsOps = fs): void {
  if (fsOps.existsSync(dest)) {
    throw new Error(`Destination already exists: ${dest}`);
  }

  fsOps.mkdirSync(path.dirname(dest), { recursive: true });
  const tempDest = createSiblingTempPath(dest, 'tmp');

  try {
    moveDir(stagingDir, tempDest, fsOps);
    fsOps.renameSync(tempDest, dest);
  } catch (err) {
    try { fsOps.rmSync(tempDest, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

function replaceDir(stagingDir: string, dest: string, fsOps: PromoteDirFsOps = fs): void {
  if (!fsOps.existsSync(dest)) {
    promoteDir(stagingDir, dest, fsOps);
    return;
  }

  fsOps.mkdirSync(path.dirname(dest), { recursive: true });

  const tempDest = createSiblingTempPath(dest, 'tmp');
  const backupDest = createSiblingTempPath(dest, 'bak');
  let backupMoved = false;

  try {
    moveDir(stagingDir, tempDest, fsOps);
    fsOps.renameSync(dest, backupDest);
    backupMoved = true;
    fsOps.renameSync(tempDest, dest);
  } catch (err) {
    try { fsOps.rmSync(tempDest, { recursive: true, force: true }); } catch {}
    if (backupMoved && !fsOps.existsSync(dest)) {
      try { fsOps.renameSync(backupDest, dest); } catch {}
    }
    throw err;
  }

  try { fsOps.rmSync(backupDest, { recursive: true, force: true }); } catch {}
}

function cloneRepoToTemp(cloneUrl: string): string {
  const tmpCloneDir = path.join(
    os.tmpdir(),
    `opencli-clone-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    execFileSync('git', ['clone', '--depth', '1', cloneUrl, tmpCloneDir], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Failed to clone plugin: ${getErrorMessage(err)}`);
  }

  return tmpCloneDir;
}

function resolveRemotePluginSource(lockEntry: LockEntry | undefined, dir: string): string {
  const source = resolveStoredPluginSource(lockEntry, dir);
  if (!source || isLocalPluginSource(source)) {
    throw new Error(`Unable to determine remote source for plugin at ${dir}`);
  }
  return source;
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
    errors.push('No command files found in plugin directory. A plugin must contain at least one .yaml, .ts, or .js command file.');
  }

  if (hasTs) {
    const pkgJsonPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      errors.push('Plugin contains .ts files but no package.json. A package.json with "type": "module" and "@jackwener/opencli" peer dependency is required for TS plugins.');
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkg.type !== 'module') {
          errors.push('Plugin package.json must have "type": "module" for TypeScript plugins.');
        }
      } catch {
        errors.push('Plugin package.json is malformed or invalid JSON.');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function installDependencies(dir: string): void {
  const pkgJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;

  try {
    execFileSync('npm', ['install', '--omit=dev'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(isWindows && { shell: true }),
    });
  } catch (err) {
    throw new Error(`npm install failed in ${dir}: ${getErrorMessage(err)}`);
  }
}

function finalizePluginRuntime(pluginDir: string): void {
  // Symlink host opencli so TS plugins resolve '@jackwener/opencli/registry'
  // against the running host, not a stale npm-published version.
  linkHostOpencli(pluginDir);

  // Transpile .ts → .js via esbuild (production node can't load .ts directly).
  transpilePluginTs(pluginDir);
}

/**
 * Shared post-install lifecycle for standalone plugins.
 */
function postInstallLifecycle(pluginDir: string): void {
  installDependencies(pluginDir);
  finalizePluginRuntime(pluginDir);
}

/**
 * Monorepo lifecycle: install shared deps once at repo root, then finalize each sub-plugin.
 */
function postInstallMonorepoLifecycle(repoDir: string, pluginDirs: string[]): void {
  installDependencies(repoDir);
  for (const pluginDir of pluginDirs) {
    finalizePluginRuntime(pluginDir);
  }
}

/**
 * Install a plugin from a source.
 * Supports:
 *   "github:user/repo"            — single plugin or full monorepo
 *   "github:user/repo/subplugin"  — specific sub-plugin from a monorepo
 *   "https://github.com/user/repo"
 *   "file:///absolute/path"       — local plugin directory (symlinked)
 *   "/absolute/path"              — local plugin directory (symlinked)
 *
 * Returns the installed plugin name(s).
 */
export function installPlugin(source: string): string | string[] {
  const parsed = parseSource(source);
  if (!parsed) {
    throw new Error(
      `Invalid plugin source: "${source}"\n` +
      `Supported formats:\n` +
      `  github:user/repo\n` +
      `  github:user/repo/subplugin\n` +
      `  https://github.com/user/repo\n` +
      `  https://<host>/<path>/repo.git\n` +
      `  ssh://git@<host>/<path>/repo.git\n` +
      `  git@<host>:user/repo.git\n` +
      `  file:///absolute/path\n` +
      `  /absolute/path`
    );
  }

  const { name: repoName, subPlugin } = parsed;

  if (parsed.type === 'local') {
    return installLocalPlugin(parsed.localPath!, repoName);
  }

  // Clone to a temporary location first so we can inspect the manifest.
  const tmpCloneDir = cloneRepoToTemp(parsed.cloneUrl!);

  try {
    const manifest = readPluginManifest(tmpCloneDir);

    // Check top-level compatibility
    if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
      throw new Error(
        `Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`
      );
    }

    if (manifest && isMonorepo(manifest)) {
      return installMonorepo(tmpCloneDir, parsed.cloneUrl!, repoName, manifest, subPlugin);
    }

    // Single plugin mode
    return installSinglePlugin(tmpCloneDir, parsed.cloneUrl!, repoName, manifest);
  } finally {
    // Clean up temp clone (may already have been moved)
    try { fs.rmSync(tmpCloneDir, { recursive: true, force: true }); } catch {}
  }
}

/** Install a single (non-monorepo) plugin. */
function installSinglePlugin(
  cloneDir: string,
  cloneUrl: string,
  name: string,
  manifest: PluginManifest | null,
): string {
  const pluginName = manifest?.name ?? name;
  const targetDir = path.join(PLUGINS_DIR, pluginName);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${pluginName}" is already installed at ${targetDir}`);
  }

  const validation = validatePluginStructure(cloneDir);
  if (!validation.valid) {
    throw new Error(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(cloneDir);
  promoteDir(cloneDir, targetDir);

  const commitHash = getCommitHash(targetDir);
  if (commitHash) {
    const lock = readLockFile();
    lock[pluginName] = {
      source: cloneUrl,
      commitHash,
      installedAt: new Date().toISOString(),
    };
    writeLockFile(lock);
  }

  return pluginName;
}

/**
 * Install a local plugin by creating a symlink.
 * Used for plugin development: the source directory is symlinked into
 * the plugins dir so changes are reflected immediately.
 */
function installLocalPlugin(localPath: string, name: string): string {
  if (!fs.existsSync(localPath)) {
    throw new Error(`Local plugin path does not exist: ${localPath}`);
  }

  const stat = fs.statSync(localPath);
  if (!stat.isDirectory()) {
    throw new Error(`Local plugin path is not a directory: ${localPath}`);
  }

  const manifest = readPluginManifest(localPath);

  if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
    throw new Error(
      `Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`
    );
  }

  const pluginName = manifest?.name ?? name;
  const targetDir = path.join(PLUGINS_DIR, pluginName);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${pluginName}" is already installed at ${targetDir}`);
  }

  const validation = validatePluginStructure(localPath);
  if (!validation.valid) {
    throw new Error(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
  }

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  const resolvedPath = path.resolve(localPath);
  const linkType = isWindows ? 'junction' : 'dir';
  fs.symlinkSync(resolvedPath, targetDir, linkType);

  installDependencies(localPath);
  finalizePluginRuntime(localPath);

  const lock = readLockFile();
  const commitHash = getCommitHash(localPath);
  lock[pluginName] = {
    source: toLocalPluginSource(resolvedPath),
    commitHash: commitHash ?? 'local',
    installedAt: new Date().toISOString(),
  };
  writeLockFile(lock);

  return pluginName;
}

function updateLocalPlugin(
  name: string,
  targetDir: string,
  lock: Record<string, LockEntry>,
  lockEntry?: LockEntry,
): void {
  const pluginDir = fs.realpathSync(targetDir);

  const validation = validatePluginStructure(pluginDir);
  if (!validation.valid) {
    log.warn(`Plugin "${name}" structure invalid:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(pluginDir);

  lock[name] = {
    source: lockEntry?.source ?? toLocalPluginSource(pluginDir),
    commitHash: getCommitHash(pluginDir) ?? 'local',
    installedAt: lockEntry?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeLockFile(lock);
}

/** Install sub-plugins from a monorepo. */
function installMonorepo(
  cloneDir: string,
  cloneUrl: string,
  repoName: string,
  manifest: PluginManifest,
  subPlugin?: string,
): string[] {
  const monoreposDir = getMonoreposDir();
  const repoDir = path.join(monoreposDir, repoName);
  const repoAlreadyInstalled = fs.existsSync(repoDir);
  const repoRoot = repoAlreadyInstalled ? repoDir : cloneDir;
  const effectiveManifest = repoAlreadyInstalled ? readPluginManifest(repoDir) : manifest;

  if (!effectiveManifest || !isMonorepo(effectiveManifest)) {
    throw new Error(`Monorepo manifest missing or invalid at ${repoRoot}`);
  }

  let pluginsToInstall = getEnabledPlugins(effectiveManifest);

  // If a specific sub-plugin was requested, filter to just that one
  if (subPlugin) {
    pluginsToInstall = pluginsToInstall.filter((p) => p.name === subPlugin);
    if (pluginsToInstall.length === 0) {
      // Check if it exists but is disabled
      const disabled = effectiveManifest.plugins?.[subPlugin];
      if (disabled) {
        throw new Error(`Sub-plugin "${subPlugin}" is disabled in the manifest.`);
      }
      throw new Error(
        `Sub-plugin "${subPlugin}" not found in monorepo. Available: ${Object.keys(effectiveManifest.plugins ?? {}).join(', ')}`
      );
    }
  }

  const installedNames: string[] = [];
  const lock = readLockFile();
  const eligiblePlugins: Array<{ name: string; entry: typeof pluginsToInstall[number]['entry'] }> = [];

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  for (const { name, entry } of pluginsToInstall) {
    // Check sub-plugin level compatibility (overrides top-level)
    if (entry.opencli && !checkCompatibility(entry.opencli)) {
      log.warn(`Skipping "${name}": requires opencli ${entry.opencli}`);
      continue;
    }

    const subDir = path.join(repoRoot, entry.path);
    if (!fs.existsSync(subDir)) {
      log.warn(`Skipping "${name}": path "${entry.path}" not found in repo.`);
      continue;
    }

    const validation = validatePluginStructure(subDir);
    if (!validation.valid) {
      log.warn(`Skipping "${name}": invalid structure — ${validation.errors.join(', ')}`);
      continue;
    }

    const linkPath = path.join(PLUGINS_DIR, name);
    if (fs.existsSync(linkPath)) {
      log.warn(`Skipping "${name}": already installed at ${linkPath}`);
      continue;
    }

    eligiblePlugins.push({ name, entry });
  }

  if (eligiblePlugins.length === 0) {
    return installedNames;
  }

  if (repoAlreadyInstalled) {
    for (const { entry } of eligiblePlugins) {
      finalizePluginRuntime(path.join(repoDir, entry.path));
    }
  } else {
    postInstallMonorepoLifecycle(cloneDir, eligiblePlugins.map((p) => path.join(cloneDir, p.entry.path)));
    fs.mkdirSync(monoreposDir, { recursive: true });
    promoteDir(cloneDir, repoDir);
  }

  const commitHash = getCommitHash(repoDir);

  for (const { name, entry } of eligiblePlugins) {
    const linkPath = path.join(PLUGINS_DIR, name);
    const subDir = path.join(repoDir, entry.path);

    // Create symlink (junction on Windows)
    const linkType = isWindows ? 'junction' : 'dir';
    fs.symlinkSync(subDir, linkPath, linkType);

    if (commitHash) {
      lock[name] = {
        source: cloneUrl,
        commitHash,
        installedAt: new Date().toISOString(),
        monorepo: { name: repoName, subPath: entry.path },
      };
    }

    installedNames.push(name);
  }

  writeLockFile(lock);
  return installedNames;
}

/**
 * Uninstall a plugin by name.
 * For monorepo sub-plugins: removes symlink and cleans up the monorepo
 * directory when no more sub-plugins reference it.
 */
export function uninstallPlugin(name: string): void {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }

  const lock = readLockFile();
  const lockEntry = lock[name];

  // Check if this is a symlink (monorepo sub-plugin)
  const isSymlink = isSymlinkSync(targetDir);

  if (isSymlink) {
    // Remove symlink only (not the actual directory)
    fs.unlinkSync(targetDir);
  } else {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Clean up monorepo directory if no more sub-plugins reference it
  if (lockEntry?.monorepo) {
    delete lock[name];
    const monoName = lockEntry.monorepo.name;
    const stillReferenced = Object.values(lock).some(
      (entry) => entry.monorepo?.name === monoName,
    );
    if (!stillReferenced) {
      const monoDir = path.join(getMonoreposDir(), monoName);
      try { fs.rmSync(monoDir, { recursive: true, force: true }); } catch {}
    }
  } else if (lock[name]) {
    delete lock[name];
  }

  writeLockFile(lock);
}

/** Synchronous check if a path is a symlink. */
function isSymlinkSync(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Update a plugin by name (git pull + re-install lifecycle).
 * For monorepo sub-plugins: pulls the monorepo root and re-runs lifecycle
 * for all sub-plugins from the same monorepo.
 */
export function updatePlugin(name: string): void {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }

  const lock = readLockFile();
  const lockEntry = lock[name];

  if (isLocalPluginSource(lockEntry?.source)) {
    updateLocalPlugin(name, targetDir, lock, lockEntry);
    return;
  }

  if (lockEntry?.monorepo) {
    const monoDir = path.join(getMonoreposDir(), lockEntry.monorepo.name);
    const monoName = lockEntry.monorepo.name;
    const cloneUrl = resolveRemotePluginSource(lockEntry, monoDir);
    const tmpCloneDir = cloneRepoToTemp(cloneUrl);

    try {
      const manifest = readPluginManifest(tmpCloneDir);
      if (!manifest || !isMonorepo(manifest)) {
        throw new Error(`Updated source is no longer a monorepo: ${cloneUrl}`);
      }

      if (manifest.opencli && !checkCompatibility(manifest.opencli)) {
        throw new Error(
          `Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`
        );
      }

      const updatedPlugins: Array<{
        name: string;
        lockEntry: LockEntry;
        manifestEntry: NonNullable<PluginManifest['plugins']>[string];
      }> = [];
      for (const [pluginName, entry] of Object.entries(lock)) {
        if (entry.monorepo?.name !== monoName) continue;
        const manifestEntry = manifest.plugins?.[pluginName];
        if (!manifestEntry || manifestEntry.disabled) {
          throw new Error(`Installed sub-plugin "${pluginName}" no longer exists in ${cloneUrl}`);
        }
        if (manifestEntry.opencli && !checkCompatibility(manifestEntry.opencli)) {
          throw new Error(`Sub-plugin "${pluginName}" requires opencli ${manifestEntry.opencli}`);
        }

        const subDir = path.join(tmpCloneDir, manifestEntry.path);
        const validation = validatePluginStructure(subDir);
        if (!validation.valid) {
          throw new Error(`Updated sub-plugin "${pluginName}" is invalid:\n- ${validation.errors.join('\n- ')}`);
        }
        updatedPlugins.push({ name: pluginName, lockEntry: entry, manifestEntry });
      }

      if (updatedPlugins.length > 0) {
        postInstallMonorepoLifecycle(tmpCloneDir, updatedPlugins.map((plugin) => path.join(tmpCloneDir, plugin.manifestEntry.path)));
      }

      replaceDir(tmpCloneDir, monoDir);

      const commitHash = getCommitHash(monoDir);
      for (const plugin of updatedPlugins) {
        const linkPath = path.join(PLUGINS_DIR, plugin.name);
        const subDir = path.join(monoDir, plugin.manifestEntry.path);
        if (isSymlinkSync(linkPath)) {
          fs.unlinkSync(linkPath);
        } else if (fs.existsSync(linkPath)) {
          throw new Error(`Expected monorepo plugin link at ${linkPath} to be a symlink`);
        }

        const linkType = isWindows ? 'junction' : 'dir';
        fs.symlinkSync(subDir, linkPath, linkType);

        if (commitHash) {
          lock[plugin.name] = {
            ...plugin.lockEntry,
            source: cloneUrl,
            commitHash,
            updatedAt: new Date().toISOString(),
            monorepo: { name: monoName, subPath: plugin.manifestEntry.path },
          };
        }
      }
      writeLockFile(lock);
    } finally {
      try { fs.rmSync(tmpCloneDir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  const cloneUrl = resolveRemotePluginSource(lockEntry, targetDir);
  const tmpCloneDir = cloneRepoToTemp(cloneUrl);

  try {
    const manifest = readPluginManifest(tmpCloneDir);
    if (manifest && isMonorepo(manifest)) {
      throw new Error(`Updated source is now a monorepo: ${cloneUrl}`);
    }

    if (manifest?.opencli && !checkCompatibility(manifest.opencli)) {
      throw new Error(
        `Plugin requires opencli ${manifest.opencli}, but current version is incompatible.`
      );
    }

    const validation = validatePluginStructure(tmpCloneDir);
    if (!validation.valid) {
      throw new Error(`Updated plugin structure is invalid:\n- ${validation.errors.join('\n- ')}`);
    }

    postInstallLifecycle(tmpCloneDir);
    replaceDir(tmpCloneDir, targetDir);

    const commitHash = getCommitHash(targetDir);
    if (commitHash) {
      const existing = lock[name];
      lock[name] = {
        source: cloneUrl,
        commitHash,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeLockFile(lock);
    }
  } finally {
    try { fs.rmSync(tmpCloneDir, { recursive: true, force: true }); } catch {}
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
 * Reads opencli-plugin.json for description/version when available.
 */
export function listPlugins(): PluginInfo[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const lock = readLockFile();
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    // Accept both real directories and symlinks (monorepo sub-plugins)
    const pluginDir = path.join(PLUGINS_DIR, entry.name);
    const isDir = entry.isDirectory() || isSymlinkSync(pluginDir);
    if (!isDir) continue;

    const commands = scanPluginCommands(pluginDir);
    const lockEntry = lock[entry.name];

    // Try to read manifest for metadata
    const manifest = readPluginManifest(pluginDir);
    // For monorepo sub-plugins, also check the monorepo root manifest
    let description = manifest?.description;
    let version = manifest?.version;
    if (lockEntry?.monorepo && !description) {
      const monoDir = path.join(getMonoreposDir(), lockEntry.monorepo.name);
      const monoManifest = readPluginManifest(monoDir);
      const subEntry = monoManifest?.plugins?.[entry.name];
      if (subEntry) {
        description = description ?? subEntry.description;
        version = version ?? subEntry.version;
      }
    }

    const source = resolveStoredPluginSource(lockEntry, pluginDir);

    plugins.push({
      name: entry.name,
      path: pluginDir,
      commands,
      source,
      version: version ?? lockEntry?.commitHash?.slice(0, 7),
      installedAt: lockEntry?.installedAt,
      monorepoName: lockEntry?.monorepo?.name,
      description,
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

/** Parse a plugin source string into clone URL, repo name, and optional sub-plugin. */
function parseSource(
  source: string,
): ParsedSource | null {
  if (source.startsWith('file://')) {
    try {
      const localPath = path.resolve(fileURLToPath(source));
      return {
        type: 'local',
        localPath,
        name: path.basename(localPath).replace(/^opencli-plugin-/, ''),
      };
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(source)) {
    const localPath = path.resolve(source);
    return {
      type: 'local',
      localPath,
      name: path.basename(localPath).replace(/^opencli-plugin-/, ''),
    };
  }

  // github:user/repo/subplugin  (monorepo specific sub-plugin)
  const githubSubMatch = source.match(
    /^github:([\w.-]+)\/([\w.-]+)\/([\w.-]+)$/,
  );
  if (githubSubMatch) {
    const [, user, repo, sub] = githubSubMatch;
    const name = repo.replace(/^opencli-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
      subPlugin: sub,
    };
  }

  // github:user/repo
  const githubMatch = source.match(/^github:([\w.-]+)\/([\w.-]+)$/);
  if (githubMatch) {
    const [, user, repo] = githubMatch;
    const name = repo.replace(/^opencli-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  // https://github.com/user/repo (or .git)
  const urlMatch = source.match(
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/,
  );
  if (urlMatch) {
    const [, user, repo] = urlMatch;
    const name = repo.replace(/^opencli-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  // ── Generic git URL support ─────────────────────────────────────────────

  // ssh://git@host/path/to/repo.git
  const sshUrlMatch = source.match(/^ssh:\/\/[^/]+\/(.*?)(?:\.git)?$/);
  if (sshUrlMatch) {
    const pathPart = sshUrlMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^opencli-plugin-/, '');
    return { type: 'git', cloneUrl: source, name };
  }

  // git@host:user/repo.git (SCP-style)
  const scpMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (scpMatch) {
    const pathPart = scpMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^opencli-plugin-/, '');
    return { type: 'git', cloneUrl: source, name };
  }

  // Generic https/http git URL (non-GitHub hosts)
  const genericHttpMatch = source.match(
    /^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/,
  );
  if (genericHttpMatch) {
    const pathPart = genericHttpMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^opencli-plugin-/, '');
    // Ensure clone URL ends with .git
    const cloneUrl = source.endsWith('.git') ? source : `${source}.git`;
    return { type: 'git', cloneUrl, name };
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
      log.warn(
        'esbuild not found. TS plugin files will not be transpiled and may fail to load. ' +
        'Install esbuild (`npm i -g esbuild`) or ensure it is available in the opencli host node_modules.'
      );
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
  } catch (err) {
    log.warn(`TS transpilation setup failed: ${getErrorMessage(err)}`);
  }
}

export {
  resolveEsbuildBin as _resolveEsbuildBin,
  getCommitHash as _getCommitHash,
  installDependencies as _installDependencies,
  parseSource as _parseSource,
  postInstallMonorepoLifecycle as _postInstallMonorepoLifecycle,
  readLockFile as _readLockFile,
  updateAllPlugins as _updateAllPlugins,
  validatePluginStructure as _validatePluginStructure,
  writeLockFile as _writeLockFile,
  isSymlinkSync as _isSymlinkSync,
  getMonoreposDir as _getMonoreposDir,
  installLocalPlugin as _installLocalPlugin,
  isLocalPluginSource as _isLocalPluginSource,
  moveDir as _moveDir,
  promoteDir as _promoteDir,
  replaceDir as _replaceDir,
  resolveStoredPluginSource as _resolveStoredPluginSource,
  toLocalPluginSource as _toLocalPluginSource,
};
