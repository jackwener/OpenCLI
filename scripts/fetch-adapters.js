#!/usr/bin/env node

/**
 * Copy official CLI adapters from the installed package to ~/.opencli/clis/.
 *
 * Update strategy (file-level granularity via adapter-manifest.json):
 * - Official files (in new manifest) are unconditionally overwritten
 * - Removed official files (in old manifest but not new) are cleaned up
 * - User-created files (never in any manifest) are preserved
 * - Skips if already installed at the same version
 *
 * Only runs on global install (npm install -g) or explicit OPENCLI_FETCH=1.
 * No network calls — copies directly from clis/ in the installed package.
 *
 * This is an ESM script (package.json type: module). No TypeScript, no src/ imports.
 */

import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

const OPENCLI_DIR = join(homedir(), '.opencli');
const USER_CLIS_DIR = join(OPENCLI_DIR, 'clis');
const MANIFEST_PATH = join(OPENCLI_DIR, 'adapter-manifest.json');
const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const BUILTIN_CLIS = join(PACKAGE_ROOT, 'clis');

function log(msg) {
  console.log(`[opencli] ${msg}`);
}

function getPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

/**
 * Read existing manifest. Returns { version, files } or null.
 */
function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Collect all relative file paths under a directory.
 */
function walkFiles(dir, prefix = '') {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      results.push(...walkFiles(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/**
 * Remove empty parent directories up to (but not including) stopAt.
 */
function pruneEmptyDirs(filePath, stopAt) {
  let dir = dirname(filePath);
  while (dir !== stopAt && dir.startsWith(stopAt)) {
    try {
      const entries = readdirSync(dir);
      if (entries.length > 0) break;
      rmSync(dir);
      dir = dirname(dir);
    } catch {
      break;
    }
  }
}

export function fetchAdapters() {
  const currentVersion = getPackageVersion();
  const oldManifest = readManifest();

  // Skip if already installed at the same version (unless forced via OPENCLI_FETCH=1)
  const isForced = process.env.OPENCLI_FETCH === '1';
  if (!isForced && currentVersion !== 'unknown' && oldManifest?.version === currentVersion) {
    log(`Adapters already up to date (v${currentVersion})`);
    return;
  }

  if (!existsSync(BUILTIN_CLIS)) {
    log('Warning: clis/ not found in package — skipping adapter copy');
    return;
  }

  const newOfficialFiles = new Set(walkFiles(BUILTIN_CLIS));
  const oldOfficialFiles = new Set(oldManifest?.files ?? []);
  mkdirSync(USER_CLIS_DIR, { recursive: true });

  // 1. Copy official files (unconditionally overwrite)
  let copied = 0;
  for (const relPath of newOfficialFiles) {
    const src = join(BUILTIN_CLIS, relPath);
    const dst = join(USER_CLIS_DIR, relPath);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { force: true });
    copied++;
  }

  // 2. Remove files that were official but are no longer (upstream deleted)
  let removed = 0;
  for (const relPath of oldOfficialFiles) {
    if (!newOfficialFiles.has(relPath)) {
      const dst = join(USER_CLIS_DIR, relPath);
      try {
        unlinkSync(dst);
        pruneEmptyDirs(dst, USER_CLIS_DIR);
        removed++;
      } catch {
        // File may not exist locally
      }
    }
  }

  // 3. Clean up stale .ts adapter files left by older versions (pre-1.7.1)
  // Older versions shipped adapters as .ts; current versions use .js only.
  let tsCleaned = 0;
  for (const relPath of walkFiles(USER_CLIS_DIR)) {
    if (relPath.endsWith('.ts') && !relPath.endsWith('.d.ts')) {
      const jsCounterpart = relPath.replace(/\.ts$/, '.js');
      if (newOfficialFiles.has(jsCounterpart)) {
        try {
          unlinkSync(join(USER_CLIS_DIR, relPath));
          pruneEmptyDirs(join(USER_CLIS_DIR, relPath), USER_CLIS_DIR);
          tsCleaned++;
        } catch { /* ignore */ }
      }
    }
  }
  if (tsCleaned > 0) log(`Cleaned up ${tsCleaned} stale .ts adapter files`);

  // 4. Clean up legacy compat shim files from ~/.opencli/
  // These were created by an older approach that placed re-export shims directly
  // in ~/.opencli/ (e.g., registry.js, errors.js, browser/). The current approach
  // uses a node_modules/@jackwener/opencli symlink instead.
  const LEGACY_SHIM_FILES = [
    'registry.js', 'errors.js', 'utils.js', 'launcher.js', 'logger.js', 'types.js',
  ];
  const LEGACY_SHIM_DIRS = [
    'browser', 'download', 'errors', 'launcher', 'logger', 'pipeline', 'registry', 'types', 'utils',
  ];
  let legacyCleaned = 0;
  for (const file of LEGACY_SHIM_FILES) {
    const p = join(OPENCLI_DIR, file);
    try {
      const content = readFileSync(p, 'utf-8');
      // Only delete if it's a re-export shim, not a user-created file
      if (content.includes("export * from 'file://")) {
        unlinkSync(p);
        legacyCleaned++;
      }
    } catch { /* doesn't exist */ }
  }
  for (const dir of LEGACY_SHIM_DIRS) {
    const p = join(OPENCLI_DIR, dir);
    try {
      // Delete individual shim files, then prune empty directory
      for (const entry of readdirSync(p)) {
        const fp = join(p, entry);
        try {
          if (!statSync(fp).isFile()) continue;
          const content = readFileSync(fp, 'utf-8');
          if (content.includes("export * from 'file://")) {
            unlinkSync(fp);
            legacyCleaned++;
          }
        } catch { /* skip unreadable entries */ }
      }
      // Remove directory only if now empty
      try {
        if (readdirSync(p).length === 0) rmSync(p);
      } catch { /* ignore */ }
    } catch { /* doesn't exist or not a directory */ }
  }

  // 5. Clean up stale .plugins.lock.json.tmp-* files
  let tmpCleaned = 0;
  try {
    for (const entry of readdirSync(OPENCLI_DIR)) {
      if (entry.startsWith('.plugins.lock.json.tmp-')) {
        try {
          unlinkSync(join(OPENCLI_DIR, entry));
          tmpCleaned++;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  if (legacyCleaned > 0 || tmpCleaned > 0) {
    log(`Cleaned up${legacyCleaned > 0 ? ` ${legacyCleaned} legacy shim files` : ''}${tmpCleaned > 0 ? `${legacyCleaned > 0 ? ',' : ''} ${tmpCleaned} stale tmp files` : ''}`);
  }

  // 6. Write updated manifest
  writeFileSync(MANIFEST_PATH, JSON.stringify({
    version: currentVersion,
    files: [...newOfficialFiles].sort(),
    updatedAt: new Date().toISOString(),
  }, null, 2));

  log(`Installed ${copied} adapter files to ${USER_CLIS_DIR}` +
    (removed > 0 ? `, removed ${removed} deprecated files` : ''));
}

function main() {
  // Skip in CI
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return;
  // Allow opt-out
  if (process.env.OPENCLI_SKIP_FETCH === '1') return;

  // Only run on global install, explicit trigger, or first-run fallback
  const isGlobal = process.env.npm_config_global === 'true';
  const isExplicit = process.env.OPENCLI_FETCH === '1';
  const isFirstRun = process.env._OPENCLI_FIRST_RUN === '1';
  if (!isGlobal && !isExplicit && !isFirstRun) return;

  fetchAdapters();
}

main();
