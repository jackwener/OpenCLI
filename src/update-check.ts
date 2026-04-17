/**
 * Non-blocking update checker.
 *
 * Pattern: register exit-hook + kick-off-background-fetch
 * - On startup: kick off background fetch (non-blocking)
 * - On process exit: read cache, print notice if newer version exists
 * - Check interval: 24 hours
 * - Notice appears AFTER command output, not before (same as npm/gh/yarn)
 * - Never delays or blocks the CLI command
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { styleText } from 'node:util';
import { PKG_VERSION } from './version.js';

const CACHE_DIR = path.join(os.homedir(), '.opencli');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@jackwener/opencli/latest';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/jackwener/OpenCLI/releases?per_page=20';

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  latestExtensionVersion?: string;
}

interface GitHubReleaseAsset {
  name: string;
}

interface GitHubRelease {
  tag_name: string;
  assets?: GitHubReleaseAsset[];
}

// Read cache once at module load — shared by both exported functions
const _cache: UpdateCache | null = (() => {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as UpdateCache;
  } catch {
    return null;
  }
})();

function writeCache(latestVersion: string, latestExtensionVersion?: string): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const data: UpdateCache = { lastCheck: Date.now(), latestVersion };
    if (latestExtensionVersion) data.latestExtensionVersion = latestExtensionVersion;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch {
    // Best-effort; never fail
  }
}

/** Compare semver strings. Returns true if `a` is strictly newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const pa = parse(a);
  const pb = parse(b);
  if (pa.some(isNaN) || pb.some(isNaN)) return false;
  const [aMaj, aMin, aPat] = pa;
  const [bMaj, bMin, bPat] = pb;
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

function isCI(): boolean {
  return !!(process.env.CI || process.env.CONTINUOUS_INTEGRATION);
}

/**
 * Register a process exit hook that prints an update notice if a newer
 * version was found on the last background check.
 * Notice appears after command output — same pattern as npm/gh/yarn.
 * Skipped during --get-completions to avoid polluting shell completion output.
 */
export function registerUpdateNoticeOnExit(): void {
  if (isCI()) return;
  if (process.argv.includes('--get-completions')) return;

  process.on('exit', (code) => {
    if (code !== 0) return; // Don't show update notice on error exit
    if (!_cache) return;
    if (!isNewer(_cache.latestVersion, PKG_VERSION)) return;
    try {
      process.stderr.write(
        styleText('yellow', `\n  Update available: v${PKG_VERSION} → v${_cache.latestVersion}\n`) +
        styleText('dim', `  Run: npm install -g @jackwener/opencli\n\n`),
      );
    } catch {
      // Ignore broken pipe (stderr closed before process exits)
    }
  });
}

function extractLatestExtensionVersionFromReleases(releases: GitHubRelease[]): string | undefined {
  for (const release of releases) {
    for (const asset of release.assets ?? []) {
      const assetMatch = asset.name.match(/^opencli-extension-v(.+)\.zip$/);
      if (assetMatch) return assetMatch[1];
    }

    const tagMatch = release.tag_name.match(/^ext-v(.+)$/);
    if (tagMatch) return tagMatch[1];
  }
  return undefined;
}

/** Fetch the latest extension version from GitHub Releases. */
async function fetchLatestExtensionVersion(): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(GITHUB_RELEASES_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': `opencli/${PKG_VERSION}`, Accept: 'application/vnd.github+json' },
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const releases = await res.json() as GitHubRelease[];
    return extractLatestExtensionVersionFromReleases(releases);
  } catch {
    return undefined;
  }
}

/**
 * Kick off a background fetch to npm registry. Writes to cache for next run.
 * Fully non-blocking — never awaited.
 */
export function checkForUpdateBackground(): void {
  if (isCI()) return;
  if (_cache && Date.now() - _cache.lastCheck < CHECK_INTERVAL_MS) return;

  void (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(NPM_REGISTRY_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': `opencli/${PKG_VERSION}` },
      });
      clearTimeout(timer);
      if (!res.ok) return;
      const data = await res.json() as { version?: string };
      if (typeof data.version === 'string') {
        const extVersion = await fetchLatestExtensionVersion();
        writeCache(data.version, extVersion);
      }
    } catch {
      // Network error: silently skip, try again next run
    }
  })();
}

/**
 * Get the cached latest extension version (if available).
 * Used by `opencli doctor` to report extension updates.
 */
export function getCachedLatestExtensionVersion(): string | undefined {
  return _cache?.latestExtensionVersion;
}

export {
  extractLatestExtensionVersionFromReleases as _extractLatestExtensionVersionFromReleases,
};
