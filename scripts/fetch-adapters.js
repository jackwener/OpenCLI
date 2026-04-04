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
 * No network calls — copies directly from dist/clis/ in the installed package.
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
const BUILTIN_CLIS = join(PACKAGE_ROOT, 'dist', 'clis');

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

  // Skip if already installed at the same version
  if (currentVersion !== 'unknown' && oldManifest?.version === currentVersion) {
    log(`Adapters already up to date (v${currentVersion})`);
    return;
  }

  if (!existsSync(BUILTIN_CLIS)) {
    log('Warning: dist/clis/ not found in package — skipping adapter copy');
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

  // 3. Write updated manifest
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
