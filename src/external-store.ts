/**
 * External CLI store - manages isolated installation lock file.
 *
 * Stores version information and installation metadata for
 * isolated-installed external CLIs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { log } from './logger.js';
import { getErrorMessage } from './errors.js';
import type { ExternalLockFile, InstalledExternalCli } from './external.js';

/**
 * Get the root directory for isolated installations: ~/.opencli/opt/
 */
export function getOptRoot(): string {
  const home = os.homedir();
  return path.join(home, '.opencli', 'opt');
}

/**
 * Get the path to the lock file: ~/.opencli/external.lock.json
 */
export function getExternalLockPath(): string {
  const home = os.homedir();
  return path.join(home, '.opencli', 'external.lock.json');
}

/**
 * Read the lock file from disk.
 * Returns empty object if file doesn't exist or is corrupted.
 */
export function readLockFile(): ExternalLockFile {
  const lockPath = getExternalLockPath();
  if (!fs.existsSync(lockPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    return JSON.parse(raw) as ExternalLockFile;
  } catch (err) {
    log.warn(`Failed to parse external lock file: ${getErrorMessage(err)}`);
    log.warn('Starting with empty lock file.');
    return {};
  }
}

/**
 * Write the lock file atomically.
 * Writes to a temp file then renames to avoid corruption.
 */
export function writeLockFile(lock: ExternalLockFile): boolean {
  const lockPath = getExternalLockPath();
  const tempPath = `${lockPath}.tmp`;
  const dir = path.dirname(lockPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(lock, null, 2);
    fs.writeFileSync(tempPath, json, 'utf8');
    // Atomically rename (works on POSIX systems, Windows has caveats but OK here)
    fs.renameSync(tempPath, lockPath);
    return true;
  } catch (err) {
    log.error(`Failed to write external lock file: ${getErrorMessage(err)}`);
    try { fs.unlinkSync(tempPath); } catch {}
    return false;
  }
}

/**
 * Get installed info for a specific CLI.
 */
export function getInstalledInfo(name: string): InstalledExternalCli | null {
  const lock = readLockFile();
  return lock[name] ?? null;
}

/**
 * Update or insert an installed CLI entry.
 */
export function upsertInstallEntry(info: InstalledExternalCli): boolean {
  const lock = readLockFile();
  lock[info.name] = info;
  return writeLockFile(lock);
}

/**
 * Remove an installed CLI entry completely.
 */
export function removeInstallEntry(name: string): boolean {
  const lock = readLockFile();
  if (!lock[name]) return false;
  delete lock[name];
  return writeLockFile(lock);
}

/**
 * Remove a specific version of an installed CLI.
 * Returns true if the version was removed.
 */
export function removeVersionEntry(name: string, version: string): boolean {
  const lock = readLockFile();
  const info = lock[name];
  if (!info) return false;

  const originalLength = info.versions.length;
  info.versions = info.versions.filter(v => v.version !== version);

  if (info.versions.length === 0) {
    delete lock[name];
  }

  return writeLockFile(lock) && originalLength !== info.versions.length;
}

/**
 * Mark a specific version as current.
 */
export function setCurrentVersion(name: string, version: string): boolean {
  const lock = readLockFile();
  const info = lock[name];
  if (!info) return false;

  for (const v of info.versions) {
    v.current = v.version === version;
  }

  return writeLockFile(lock);
}

/**
 * Get the currently active version for an installed CLI.
 */
export function getCurrentVersion(info: InstalledExternalCli): string | null {
  const current = info.versions.find(v => v.current);
  if (current) return current.version;
  // If none marked current, return the most recently installed
  if (info.versions.length > 0) {
    // Sort by installedAt descending
    const sorted = [...info.versions].sort((a, b) =>
      new Date(b.installedAt).getTime() - new Date(a.installedAt).getTime()
    );
    return sorted[0].version;
  }
  return null;
}

/**
 * Get the full binary path for the currently active version.
 */
export function getCurrentBinaryPath(info: InstalledExternalCli): string | null {
  const version = getCurrentVersion(info);
  if (!version) return null;
  const entry = info.versions.find(v => v.version === version);
  if (!entry) return null;

  // For npm packages installed with --prefix, binary is in node_modules/.bin
  // Try common locations
  const locations = [
    path.join(entry.installPath, 'node_modules', '.bin', info.binaryName),
    path.join(entry.installPath, 'bin', info.binaryName),
    path.join(entry.installPath, info.binaryName),
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc) || fs.existsSync(`${loc}.cmd`)) {
      return loc;
    }
  }

  // Fallback to the expected location
  return path.join(entry.installPath, info.binaryName);
}
