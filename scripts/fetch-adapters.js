#!/usr/bin/env node

/**
 * Fetch official CLI adapters into ~/.opencli/clis/ on postinstall.
 *
 * Update strategy (file-level granularity via adapter-manifest.json):
 * - Official files (in new manifest) are unconditionally overwritten
 * - Removed official files (in old manifest but not new) are cleaned up
 * - User-created files (never in any manifest) are preserved
 * - Skips fetch if already installed at the same version
 *
 * Only runs on global install (npm install -g) or explicit OPENCLI_FETCH=1.
 *
 * This is an ESM script (package.json type: module). No TypeScript, no src/ imports.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const REPO_URL = 'https://github.com/jackwener/opencli.git';
const TARBALL_URL = 'https://github.com/jackwener/opencli/archive/refs/heads/main.tar.gz';
const OPENCLI_DIR = join(homedir(), '.opencli');
const USER_CLIS_DIR = join(OPENCLI_DIR, 'clis');
const MANIFEST_PATH = join(OPENCLI_DIR, 'adapter-manifest.json');

function log(msg) {
  console.log(`[opencli] ${msg}`);
}

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getPackageVersion() {
  try {
    const pkgPath = resolve(import.meta.dirname, '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
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
 * Clone repo shallowly, return { repoDir, tmpRoot }.
 */
function cloneRepo() {
  const tmpRoot = join(tmpdir(), `opencli-fetch-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmpRoot, { recursive: true });

  if (hasGit()) {
    log('Fetching adapters via git clone...');
    const repoDir = join(tmpRoot, 'repo');
    execFileSync('git', [
      'clone', '--depth', '1', '--filter=blob:none', '--sparse',
      REPO_URL, repoDir,
    ], { stdio: 'pipe', timeout: 60_000 });
    execFileSync('git', ['sparse-checkout', 'set', 'clis'], {
      cwd: repoDir,
      stdio: 'pipe',
    });
    return { repoDir, tmpRoot };
  }

  // Fallback: tarball download
  log('git not found, fetching adapters via tarball...');
  const tarball = join(tmpRoot, 'opencli.tar.gz');
  execFileSync('curl', ['-sL', TARBALL_URL, '-o', tarball], {
    stdio: 'pipe',
    timeout: 120_000,
  });
  execFileSync('tar', ['xzf', tarball, '-C', tmpRoot], { stdio: 'pipe' });

  // Find extracted directory (opencli-main/)
  const extracted = readdirSync(tmpRoot).find(f =>
    f.startsWith('opencli-') && statSync(join(tmpRoot, f)).isDirectory()
  );
  if (!extracted) throw new Error('Failed to extract tarball');
  return { repoDir: join(tmpRoot, extracted), tmpRoot };
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

function cleanup(tmpRoot) {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
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

  let repoDir, tmpRoot;
  try {
    ({ repoDir, tmpRoot } = cloneRepo());
  } catch (err) {
    log(`Warning: could not fetch adapters: ${err.message}`);
    return;
  }

  const srcClis = join(repoDir, 'clis');
  if (!existsSync(srcClis)) {
    log('Warning: no clis/ directory found in repo');
    cleanup(tmpRoot);
    return;
  }

  const newOfficialFiles = new Set(walkFiles(srcClis));
  const oldOfficialFiles = new Set(oldManifest?.files ?? []);
  mkdirSync(USER_CLIS_DIR, { recursive: true });

  // 1. Copy new official files (unconditionally overwrite)
  let copied = 0;
  for (const relPath of newOfficialFiles) {
    const src = join(srcClis, relPath);
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
  cleanup(tmpRoot);
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
