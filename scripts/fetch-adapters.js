#!/usr/bin/env node

/**
 * Fetch official CLI adapters into ~/.opencli/clis/ on postinstall.
 *
 * Strategy:
 * - git clone --depth 1 (fast, minimal bandwidth)
 * - Fallback: GitHub tarball download if git is unavailable
 * - Official files (listed in manifest) are unconditionally overwritten on update
 * - User-created files (not in manifest) are preserved
 *
 * This script is plain Node.js — no TypeScript, no imports from src/.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone repo shallowly, return path to temp dir.
 */
function cloneRepo() {
  const tmp = join(tmpdir(), `opencli-fetch-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp, { recursive: true });

  if (hasGit()) {
    log('Fetching adapters via git clone...');
    execSync(`git clone --depth 1 --filter=blob:none --sparse "${REPO_URL}" "${tmp}/repo"`, {
      stdio: 'pipe',
      timeout: 60_000,
    });
    execSync('git sparse-checkout set clis', {
      cwd: join(tmp, 'repo'),
      stdio: 'pipe',
    });
    return join(tmp, 'repo');
  }

  // Fallback: tarball download
  log('git not found, fetching adapters via tarball...');
  const tarball = join(tmp, 'opencli.tar.gz');
  execSync(`curl -sL "${TARBALL_URL}" -o "${tarball}"`, {
    stdio: 'pipe',
    timeout: 120_000,
  });
  execSync(`tar xzf "${tarball}" -C "${tmp}"`, { stdio: 'pipe' });

  // Find extracted directory (opencli-main/)
  const extracted = readdirSync(tmp).find(f =>
    f.startsWith('opencli-') && statSync(join(tmp, f)).isDirectory()
  );
  if (!extracted) throw new Error('Failed to extract tarball');
  return join(tmp, extracted);
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

function main() {
  // Skip in CI
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) return;
  // Allow opt-out
  if (process.env.OPENCLI_SKIP_FETCH === '1') return;

  let repoDir;
  try {
    repoDir = cloneRepo();
  } catch (err) {
    log(`Warning: could not fetch adapters: ${err.message}`);
    log('Adapters will be fetched on first run.');
    return;
  }

  const srcClis = join(repoDir, 'clis');
  if (!existsSync(srcClis)) {
    log('Warning: no clis/ directory found in repo');
    cleanup(repoDir);
    return;
  }

  // Build manifest of official files
  const officialFiles = walkFiles(srcClis);
  mkdirSync(USER_CLIS_DIR, { recursive: true });

  // Copy official files (unconditionally overwrite)
  let copied = 0;
  for (const relPath of officialFiles) {
    const src = join(srcClis, relPath);
    const dst = join(USER_CLIS_DIR, relPath);
    mkdirSync(join(dst, '..'), { recursive: true });
    cpSync(src, dst, { force: true });
    copied++;
  }

  // Write manifest so we know which files are official
  writeFileSync(MANIFEST_PATH, JSON.stringify({
    version: getPackageVersion(),
    files: officialFiles,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  log(`Installed ${copied} adapter files to ${USER_CLIS_DIR}`);
  cleanup(repoDir);
}

function getPackageVersion() {
  try {
    const pkgPath = resolve(import.meta.dirname, '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

function cleanup(dir) {
  try {
    rmSync(dir.replace(/\/repo$/, ''), { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

main();
