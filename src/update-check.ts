/**
 * Non-blocking update checker.
 *
 * Pattern: register exit-hook + kick-off-background-fetch
 * - On startup: kick off background fetch (non-blocking)
 * - On process exit: read cache, print notice if newer version exists
 * - Check interval: 24 hours
 * - Notice appears AFTER command output, not before (same as npm/gh/yarn)
 * - Never delays or blocks the CLI command
 *
 * Cache is shared between the CLI process (writes latestVersion / latestExtensionVersion
 * via background fetch) and the daemon process (writes currentExtensionVersion /
 * extensionLastSeenAt via `recordExtensionVersion` on each hello). Writes use a
 * read-merge-write pattern so neither side clobbers the other.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PKG_VERSION } from './version.js';

const CACHE_DIR = path.join(os.homedir(), '.opencli');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const EXTENSION_RETRY_INTERVAL_MS = 60 * 60 * 1000; // 1h — backoff after a failed extension lookup
const EXTENSION_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@jackwener/opencli/latest';
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/jackwener/OpenCLI/releases?per_page=20';

interface UpdateCache {
  // CLI npm fetch fields — present once `checkForUpdateBackground` has succeeded.
  // Optional because the daemon may write the cache first via `recordExtensionVersion`.
  lastCheck?: number;
  latestVersion?: string;
  latestExtensionVersion?: string;
  // Extension lookup bookkeeping, tracked independently of `lastCheck` because
  // the GitHub endpoint is rate-limited per IP and fails on its own schedule.
  extLastCheck?: number;
  extLastFetchOk?: boolean;
  extEtag?: string;
  // Daemon hello fields.
  currentExtensionVersion?: string;
  extensionLastSeenAt?: number;
}

interface GitHubReleaseAsset {
  name: string;
}

interface GitHubRelease {
  tag_name: string;
  assets?: GitHubReleaseAsset[];
}

function readCacheSync(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as UpdateCache;
  } catch {
    return null;
  }
}

// Read cache once at module load — shared by both exported functions
const _cache: UpdateCache | null = readCacheSync();

function writeCacheMerge(updates: Partial<UpdateCache>): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const existing = readCacheSync() ?? {};
    const merged = { ...existing, ...updates } as UpdateCache;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(merged), 'utf-8');
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

interface NoticeInputs {
  cliVersion: string;
  cache: UpdateCache | null;
  now: number;
}

interface NoticeLines {
  cli?: string;
  extension?: string;
}

/** Pure function: derive notice text from cache state. Exported for tests. */
function buildUpdateNotices({ cliVersion, cache, now }: NoticeInputs): NoticeLines {
  if (!cache) return {};
  const lines: NoticeLines = {};
  if (cache.latestVersion && isNewer(cache.latestVersion, cliVersion)) {
    lines.cli =
      `\n  Update available: v${cliVersion} → v${cache.latestVersion}\n` +
      `  Run: npm install -g @jackwener/opencli\n`;
  }
  const { currentExtensionVersion, latestExtensionVersion, extensionLastSeenAt } = cache;
  if (
    currentExtensionVersion &&
    latestExtensionVersion &&
    extensionLastSeenAt &&
    now - extensionLastSeenAt < EXTENSION_STALE_MS &&
    isNewer(latestExtensionVersion, currentExtensionVersion)
  ) {
    lines.extension =
      `\n  Extension update available: v${currentExtensionVersion} → v${latestExtensionVersion}\n` +
      `  Download: https://github.com/jackwener/opencli/releases\n`;
  }
  return lines;
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
    const { cli, extension } = buildUpdateNotices({
      cliVersion: PKG_VERSION,
      cache: _cache,
      now: Date.now(),
    });
    if (!cli && !extension) return;
    try {
      process.stderr.write(`${cli ?? ''}${extension ?? ''}\n`);
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

interface ExtensionFetchResult {
  /** Whether the lookup reached a usable answer (2xx or 304). */
  ok: boolean;
  version?: string;
  etag?: string;
}

/**
 * How long to wait before retrying the extension lookup. A successful lookup
 * waits the normal 24h; a failed one retries within the hour so a transient
 * rate-limit or outage heals itself instead of silencing the notice until the
 * next day.
 */
function extensionRecheckDelay(cache: UpdateCache | null): number {
  return cache?.extLastFetchOk === false ? EXTENSION_RETRY_INTERVAL_MS : CHECK_INTERVAL_MS;
}

/** Fetch the latest extension version from GitHub Releases. */
async function fetchLatestExtensionVersion(etag?: string): Promise<ExtensionFetchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const headers: Record<string, string> = {
      'User-Agent': `opencli/${PKG_VERSION}`,
      Accept: 'application/vnd.github+json',
    };
    // Send the previous ETag so an unchanged release list comes back as a 304
    // with no body to parse. Note this still consumes unauthenticated
    // rate-limit budget (GitHub only exempts 304s for authenticated requests),
    // so the retry backoff above is what actually keeps this lookup alive under
    // a 403 — the ETag just avoids re-downloading 20 release objects.
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(GITHUB_RELEASES_URL, { signal: controller.signal, headers });
    clearTimeout(timer);
    // 304: nothing changed, so the cached version is still current.
    if (res.status === 304) return { ok: true, etag };
    if (!res.ok) return { ok: false };
    const releases = await res.json() as GitHubRelease[];
    return {
      ok: true,
      version: extractLatestExtensionVersionFromReleases(releases),
      etag: res.headers.get('etag') ?? undefined,
    };
  } catch {
    return { ok: false };
  }
}

interface DueChecks {
  /** npm registry lookup for the CLI version. */
  cli: boolean;
  /** GitHub Releases lookup for the extension version. */
  extension: boolean;
}

/**
 * Pure function: decide which lookups are due. Exported for tests.
 *
 * The two lookups are gated independently. They previously shared `lastCheck`,
 * which meant a failed GitHub call still stamped the 24h cooldown without
 * recording an extension version — the next run then returned early, so the
 * lookup never retried and the extension notice stayed silent indefinitely.
 */
function computeDueChecks(cache: UpdateCache | null, now: number): DueChecks {
  return {
    cli: !cache?.lastCheck || now - cache.lastCheck >= CHECK_INTERVAL_MS,
    extension: !cache?.extLastCheck || now - cache.extLastCheck >= extensionRecheckDelay(cache),
  };
}

/**
 * Kick off a background fetch to npm registry. Writes to cache for next run.
 * Fully non-blocking — never awaited.
 */
export function checkForUpdateBackground(): void {
  if (isCI()) return;
  const { cli: cliDue, extension: extDue } = computeDueChecks(_cache, Date.now());
  if (!cliDue && !extDue) return;

  void (async () => {
    if (cliDue) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(NPM_REGISTRY_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': `opencli/${PKG_VERSION}` },
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json() as { version?: string };
          if (typeof data.version === 'string') {
            writeCacheMerge({ lastCheck: Date.now(), latestVersion: data.version });
          }
        }
      } catch {
        // Network error: silently skip, try again next run.
      }
    }

    if (extDue) {
      const result = await fetchLatestExtensionVersion(_cache?.extEtag);
      // Stamp extLastCheck on every outcome so a hard-down endpoint cannot spin
      // on each invocation, but use a short backoff on failure (see
      // extensionRecheckDelay) so the lookup recovers on its own.
      const updates: Partial<UpdateCache> = { extLastCheck: Date.now() };
      if (result.version) updates.latestExtensionVersion = result.version;
      if (result.etag) updates.extEtag = result.etag;
      updates.extLastFetchOk = result.ok;
      writeCacheMerge(updates);
    }
  })();
}

/**
 * Stash the current extension version into the shared cache. Called by the
 * daemon on each hello handshake. Lets the next CLI process compare against
 * the latest known release and print an exit notice without any extra I/O.
 */
export function recordExtensionVersion(version: string): void {
  if (typeof version !== 'string' || !version.trim()) return;
  writeCacheMerge({
    currentExtensionVersion: version.trim(),
    extensionLastSeenAt: Date.now(),
  });
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
  buildUpdateNotices as _buildUpdateNotices,
  computeDueChecks as _computeDueChecks,
  EXTENSION_STALE_MS as _EXTENSION_STALE_MS,
  CHECK_INTERVAL_MS as _CHECK_INTERVAL_MS,
  EXTENSION_RETRY_INTERVAL_MS as _EXTENSION_RETRY_INTERVAL_MS,
};
