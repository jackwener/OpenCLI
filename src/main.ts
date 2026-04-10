#!/usr/bin/env node
/**
 * opencli — Make any website your CLI. AI-powered.
 */

// Ensure standard system paths are available for child processes.
// Some environments (GUI apps, cron, IDE terminals) launch with a minimal PATH
// that excludes /usr/local/bin, /usr/sbin, etc., causing external CLIs to fail.
if (process.platform !== 'win32') {
  const std = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const cur = new Set((process.env.PATH ?? '').split(':').filter(Boolean));
  for (const p of std) cur.add(p);
  process.env.PATH = [...cur].join(':');
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompletionsFromManifest, hasAllManifests, printCompletionScriptFast } from './completion-fast.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';
import { PKG_VERSION } from './version.js';
import { EXIT_CODES } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Adapters are JS-first and live at <package-root>/clis/.
// Use findPackageRoot so the path works both in dev (src/main.ts) and prod (dist/src/main.js).
const BUILTIN_CLIS = path.join(findPackageRoot(__filename), 'clis');
const USER_CLIS = path.join(os.homedir(), '.opencli', 'clis');

// ── Ultra-fast path: lightweight commands bypass full discovery ──────────
// These are high-frequency or trivial paths that must not pay the startup tax.
const argv = process.argv.slice(2);

// Fast path: --version (only when it's the top-level intent, not passed to a subcommand)
// e.g. `opencli --version` or `opencli -V`, but NOT `opencli gh --version`
if (argv[0] === '--version' || argv[0] === '-V') {
  process.stdout.write(PKG_VERSION + '\n');
  process.exit(EXIT_CODES.SUCCESS);
}

// Fast path: completion <shell> — print shell script without discovery
if (argv[0] === 'completion' && argv.length >= 2) {
  if (printCompletionScriptFast(argv[1])) {
    process.exit(EXIT_CODES.SUCCESS);
  }
  // Unknown shell — fall through to full path for proper error handling
}

// Fast path: --get-completions — read from manifest, skip discovery
const getCompIdx = process.argv.indexOf('--get-completions');
if (getCompIdx !== -1) {
  // Only require manifest for directories that actually exist.
  // If user clis dir doesn't exist, there are no user adapters to miss.
  const manifestPaths = [getCliManifestPath(BUILTIN_CLIS)];
  try { fs.accessSync(USER_CLIS); manifestPaths.push(getCliManifestPath(USER_CLIS)); } catch { /* no user dir */ }
  if (hasAllManifests(manifestPaths)) {
    const rest = process.argv.slice(getCompIdx + 1);
    let cursor: number | undefined;
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--cursor' && i + 1 < rest.length) {
        cursor = parseInt(rest[i + 1], 10);
        i++;
      } else {
        words.push(rest[i]);
      }
    }
    if (cursor === undefined) cursor = words.length;
    const candidates = getCompletionsFromManifest(words, cursor, manifestPaths);
    process.stdout.write(candidates.join('\n') + '\n');
    process.exit(EXIT_CODES.SUCCESS);
  }
  // No manifest — fall through to full discovery path below
}

// ── Full startup path ───────────────────────────────────────────────────
// Dynamic imports: these are deferred so the fast path above never pays the cost.
const { discoverClis, discoverPlugins, ensureUserCliCompatShims, ensureUserAdapters } = await import('./discovery.js');
const { getCompletions } = await import('./completion.js');
const { runCli } = await import('./cli.js');
const { emitHook } = await import('./hooks.js');
const { installNodeNetwork } = await import('./node-network.js');
const { registerUpdateNoticeOnExit, checkForUpdateBackground } = await import('./update-check.js');

installNodeNetwork();

// Parallelise independent startup I/O:
//  - Built-in adapter discovery has no dependency on user-dir setup.
//  - ensureUserCliCompatShims and ensureUserAdapters operate on different paths.
// User-CLI discovery must wait for shims + adapters; plugins run last to allow overrides.
const [, ,] = await Promise.all([
  ensureUserCliCompatShims(),
  ensureUserAdapters(),
  discoverClis(BUILTIN_CLIS),
]);
await discoverClis(USER_CLIS);
await discoverPlugins();

// Register exit hook: notice appears after command output (same as npm/gh/yarn)
registerUpdateNoticeOnExit();
// Kick off background fetch for next run (non-blocking)
checkForUpdateBackground();

// ── Fallback completion: manifest unavailable, use full registry ─────────
if (getCompIdx !== -1) {
  const rest = process.argv.slice(getCompIdx + 1);
  let cursor: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cursor' && i + 1 < rest.length) {
      cursor = parseInt(rest[i + 1], 10);
      i++;
    } else {
      words.push(rest[i]);
    }
  }
  if (cursor === undefined) cursor = words.length;
  const candidates = getCompletions(words, cursor);
  process.stdout.write(candidates.join('\n') + '\n');
  process.exit(EXIT_CODES.SUCCESS);
}

await emitHook('onStartup', { command: '__startup__', args: {} });
runCli(BUILTIN_CLIS, USER_CLIS);
