#!/usr/bin/env node

/**
 * Sparse adapter sync: tracks official adapter hashes without deleting user data.
 *
 * Strategy (hash-based, site-level granularity):
 * - When an official site has upstream changes: preserve the local override
 *   and print an explicit follow-up command for the user to run if they want
 *   to reset it.
 * - When an official site has no changes: leave local override intact
 * - User-created custom sites (not in package): always preserved
 * - Skips entirely if already synced at the same version
 *
 * ~/.opencli/clis/ is a sparse override layer, not a full copy.
 * Only eject-ed or user-modified sites appear here.
 *
 * Only runs on global install (npm install -g) or explicit OPENCLI_FETCH=1.
 * No network calls — reads hashes from clis/ in the installed package.
 *
 * This is an ESM script (package.json type: module). No TypeScript, no src/ imports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
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
 * Compute SHA-256 hash of file content.
 */
function fileHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Read existing manifest. Returns { version, files, hashes } or null.
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
  const rawHashes = oldManifest?.hashes;
  // Guard against corrupted manifest: if hashes is a non-object type (string, number,
  // array), skip sync to avoid false-positive "changed" detection that deletes overrides.
  // null/undefined are treated as empty (old manifests may lack the field).
  if (rawHashes != null && (typeof rawHashes !== 'object' || Array.isArray(rawHashes))) {
    log('Warning: adapter-manifest.json has corrupted hashes — skipping sync. Will fix on next run.');
    return;
  }
  const oldHashes = rawHashes ?? {};
  mkdirSync(USER_CLIS_DIR, { recursive: true });

  // 1. Compute new hashes and detect which sites have changes
  const newHashes = {};
  const siteFiles = new Map(); // site -> [relPath, ...]
  for (const relPath of newOfficialFiles) {
    const src = join(BUILTIN_CLIS, relPath);
    const srcHash = fileHash(src);
    newHashes[relPath] = srcHash;

    const site = relPath.split('/')[0];
    if (!siteFiles.has(site)) siteFiles.set(site, []);
    siteFiles.get(site).push(relPath);
  }

  // Determine which sites have any changed/new/removed files
  const changedSites = new Set();
  for (const [site, files] of siteFiles) {
    for (const relPath of files) {
      if (oldHashes[relPath] !== newHashes[relPath]) {
        changedSites.add(site);
        break;
      }
    }
  }
  // Also mark sites that had files removed
  for (const relPath of oldOfficialFiles) {
    if (!newOfficialFiles.has(relPath)) {
      changedSites.add(relPath.split('/')[0]);
    }
  }

  // 2. Sparse sync: preserve local overrides for changed/removed official sites.
  //    This script runs during install/update, so it must not make destructive
  //    decisions on the user's behalf. Users can reset a site explicitly with
  //    `opencli adapter reset <site>` after reviewing their local changes.
  const preservedOverrides = [];
  for (const site of changedSites) {
    const siteDir = join(USER_CLIS_DIR, site);
    if (existsSync(siteDir)) {
      preservedOverrides.push(site);
    }
  }

  // 3. Detect stale .ts adapter files left by older versions (pre-1.7.1)
  // Older versions shipped adapters as .ts; current versions use .js only.
  const staleTsFiles = [];
  for (const relPath of walkFiles(USER_CLIS_DIR)) {
    if (relPath.endsWith('.ts') && !relPath.endsWith('.d.ts')) {
      const jsCounterpart = relPath.replace(/\.ts$/, '.js');
      if (newOfficialFiles.has(jsCounterpart)) {
        staleTsFiles.push(relPath);
      }
    }
  }
  if (staleTsFiles.length > 0) {
    log(`Detected ${staleTsFiles.length} stale .ts adapter file(s); preserved them. Review ~/.opencli/clis/ before removing them manually.`);
  }

  // 3b. Detect stale .yaml/.yml adapter files left by older versions (pre-1.7.0)
  // Older versions shipped adapters as YAML; current versions use .js only.
  // These are no longer discoverable and can shadow the current .js adapter layout.
  const staleYamlFiles = [];
  for (const relPath of walkFiles(USER_CLIS_DIR)) {
    if (relPath.endsWith('.yaml') || relPath.endsWith('.yml')) {
      const jsCounterpart = relPath.replace(/\.ya?ml$/, '.js');
      if (newOfficialFiles.has(jsCounterpart)) {
        staleYamlFiles.push(relPath);
      }
    }
  }
  if (staleYamlFiles.length > 0) {
    log(`Detected ${staleYamlFiles.length} stale .yaml/.yml adapter file(s); preserved them. Review ~/.opencli/clis/ before removing them manually.`);
  }

  // 4. Detect legacy compat shim files from ~/.opencli/
  // These were created by an older approach that placed re-export shims directly
  // in ~/.opencli/ (e.g., registry.js, errors.js, browser/). The current approach
  // uses a node_modules/@jackwener/opencli symlink instead.
  const LEGACY_SHIM_FILES = [
    'registry.js', 'errors.js', 'utils.js', 'launcher.js', 'logger.js', 'types.js',
  ];
  const LEGACY_SHIM_DIRS = [
    'browser', 'download', 'errors', 'launcher', 'logger', 'pipeline', 'registry', 'types', 'utils',
  ];
  const legacyShimPaths = [];
  for (const file of LEGACY_SHIM_FILES) {
    const p = join(OPENCLI_DIR, file);
    try {
      const content = readFileSync(p, 'utf-8');
      // Only report if it's a re-export shim, not a user-created file
      if (content.includes("export * from 'file://")) {
        legacyShimPaths.push(p);
      }
    } catch { /* doesn't exist */ }
  }
  for (const dir of LEGACY_SHIM_DIRS) {
    const p = join(OPENCLI_DIR, dir);
    try {
      // Report individual shim files without removing them during install.
      for (const entry of readdirSync(p)) {
        const fp = join(p, entry);
        try {
          if (!statSync(fp).isFile()) continue;
          const content = readFileSync(fp, 'utf-8');
          if (content.includes("export * from 'file://")) {
            legacyShimPaths.push(fp);
          }
        } catch { /* skip unreadable entries */ }
      }
    } catch { /* doesn't exist or not a directory */ }
  }

  // 5. Detect stale .plugins.lock.json.tmp-* files
  const staleTmpFiles = [];
  try {
    for (const entry of readdirSync(OPENCLI_DIR)) {
      if (entry.startsWith('.plugins.lock.json.tmp-')) {
        staleTmpFiles.push(join(OPENCLI_DIR, entry));
      }
    }
  } catch { /* ignore */ }

  if (legacyShimPaths.length > 0 || staleTmpFiles.length > 0) {
    log(`Detected${legacyShimPaths.length > 0 ? ` ${legacyShimPaths.length} legacy shim file(s)` : ''}${staleTmpFiles.length > 0 ? `${legacyShimPaths.length > 0 ? ',' : ''} ${staleTmpFiles.length} stale tmp file(s)` : ''}; preserved them for manual review.`);
  }

  // 6. Write updated manifest (with per-file hashes for smart sync)
  writeFileSync(MANIFEST_PATH, JSON.stringify({
    version: currentVersion,
    files: [...newOfficialFiles].sort(),
    hashes: newHashes,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  if (preservedOverrides.length > 0) {
    log(`Preserved ${preservedOverrides.length} local override(s) for changed official site(s): ${preservedOverrides.sort().join(', ')}`);
    log('To restore official versions, review your local files first, then run: opencli adapter reset <site>');
  }

  log(`Synced adapter manifest: ${preservedOverrides.length} local override(s) preserved` +
    (staleTsFiles.length > 0 ? `, ${staleTsFiles.length} stale .ts file(s) preserved` : '') +
    (staleYamlFiles.length > 0 ? `, ${staleYamlFiles.length} stale .yaml file(s) preserved` : ''));
}

function main() {
  // Skip in CI
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return;
  // Only run on global install, explicit trigger, or first-run fallback
  const isGlobal = process.env.npm_config_global === 'true';
  const isExplicit = process.env.OPENCLI_FETCH === '1';
  const isFirstRun = process.env._OPENCLI_FIRST_RUN === '1';
  if (!isGlobal && !isExplicit && !isFirstRun) return;

  fetchAdapters();
}

main();
