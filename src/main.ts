#!/usr/bin/env node
/**
 * opencli — Make any website your CLI. AI-powered.
 */

// GUI apps and cron can start with a minimal PATH. Keep standard system paths
// available for media helpers such as yt-dlp and ffmpeg.
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
import { isSupportedNodeVersion, MIN_SUPPORTED_NODE_MAJOR } from './runtime-detect.js';
import { isIgnorableDaemonPortEnv, unsupportedDaemonPortEnvMessage } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
// Adapters are JS-first and live at <package-root>/clis/.
// Use findPackageRoot so the path works both in dev (src/main.ts) and prod (dist/src/main.js).
const BUILTIN_CLIS = path.join(findPackageRoot(__filename), 'clis');
const USER_CLIS = path.join(os.homedir(), '.opencli', 'clis');

// ── Ultra-fast path: lightweight commands bypass full discovery ──────────
// These are high-frequency or trivial paths that must not pay the startup tax.
const argv = process.argv.slice(2);

if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' && !isSupportedNodeVersion(process.version)) {
  const { emitFailure } = await import('./command-output.js');
  emitFailure({ code: 'CONFIG', message: `OpenCLI requires Node.js >= ${MIN_SUPPORTED_NODE_MAJOR}.0.0; current runtime: ${process.version}.`, hint: 'Upgrade Node.js, then retry.' }, EXIT_CODES.CONFIG_ERROR);
  process.exit(EXIT_CODES.CONFIG_ERROR);
}

if (!isIgnorableDaemonPortEnv(process.env.OPENCLI_DAEMON_PORT)) {
  const { emitFailure } = await import('./command-output.js');
  emitFailure({ code: 'CONFIG', message: unsupportedDaemonPortEnvMessage(process.env.OPENCLI_DAEMON_PORT) }, EXIT_CODES.CONFIG_ERROR);
  process.exit(EXIT_CODES.CONFIG_ERROR);
}

// Fast path: --version (only when it's the top-level intent, not passed to a subcommand)
// e.g. `opencli --version` or `opencli -V`, but NOT `opencli browser --version`
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
  // Only include manifests that actually exist on disk.
  // With sparse override, the user clis dir may exist but have no manifest.
  const manifestPaths = [getCliManifestPath(BUILTIN_CLIS)];
  const userManifest = getCliManifestPath(USER_CLIS);
  try { fs.accessSync(userManifest); manifestPaths.push(userManifest); } catch { /* no user manifest */ }
  if (hasAllManifests(manifestPaths)) {
    const rest = process.argv.slice(getCompIdx + 1);
    let cursor: number | undefined;
    const words: string[] = [];
    for (let i = 0;i < rest.length;i++) {
      if (rest[i] === '--cursor' && i + 1 < rest.length) {
        cursor = parseInt(rest[i + 1], 10);
        i++;
      } else {
        words.push(rest[i]);
      }
    }
    if (cursor === undefined) cursor = words.length;
    const candidates = getCompletionsFromManifest(words, cursor, manifestPaths);
    if (candidates !== null) {
      process.stdout.write(candidates.join('\n') + '\n');
      process.exit(EXIT_CODES.SUCCESS);
    }
  }
  // Manifest unavailable or invalid — fall through to full discovery below.
}

// ── Full startup path ───────────────────────────────────────────────────
// Dynamic imports: these are deferred so the fast path above never pays the cost.
try {
  const { discoverClis, discoverPlugins, ensureUserCliCompatShims, ensureUserAdapters } = await import('./discovery.js');
  const { getCompletions } = await import('./completion.js');
  const { runCli } = await import('./cli.js');
  const { emitHook } = await import('./hooks.js');
  const { installNodeNetwork } = await import('./node-network.js');
  const { registerUpdateNoticeOnExit, checkForUpdateBackground } = await import('./update-check.js');

  installNodeNetwork();

  // Parallelise independent startup I/O:
  //  - Built-in adapter discovery has no dependency on user-dir setup.
  //  - ensureUserCliCompatShims and ensureUserAdapters operate on different paths
  //    (~/.opencli/node_modules/ vs ~/.opencli/clis/ + adapter-manifest.json).
  //  - registerCommand() overwrites on name collision (see registry.ts), so
  //    user-CLI discovery MUST run after built-in discovery to preserve the
  //    intended override order (user adapters override built-in ones).
  //  - discoverPlugins runs last: plugins may override both built-in and user CLIs.
  const skipUserDiscovery = argv[0] === 'convention-audit';
  if (skipUserDiscovery) {
    await discoverClis(BUILTIN_CLIS);
  } else {
    const [, ,] = await Promise.all([
      ensureUserCliCompatShims(),
      ensureUserAdapters(),
      discoverClis(BUILTIN_CLIS),
    ]);
    await discoverClis(USER_CLIS);
    await discoverPlugins();
  }

  // Register exit hook: notice appears after command output (same as npm/gh/yarn)
  registerUpdateNoticeOnExit();
  // Kick off background fetch for next run (non-blocking)
  checkForUpdateBackground();

  // ── Fallback completion: manifest unavailable, use full registry ─────────
  if (getCompIdx !== -1) {
    const rest = process.argv.slice(getCompIdx + 1);
    let cursor: number | undefined;
    const words: string[] = [];
    for (let i = 0;i < rest.length;i++) {
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

  // Preserve literal leading-dash adapter arguments; browser options are parsed by Commander.
  const { escapeLeadingDashPositional } = await import('./cli-argv-preprocess.js');
  try {
    const manifestPath = getCliManifestPath(BUILTIN_CLIS);
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (Array.isArray(manifest)) process.argv.splice(2, process.argv.length - 2,
        ...escapeLeadingDashPositional(process.argv.slice(2), manifest));
    }
  } catch { /* manifest unavailable; parse the original arguments */ }

  await emitHook('onStartup', { command: '__startup__', args: {} });
  await runCli(BUILTIN_CLIS, USER_CLIS);

} catch (error) {
  const { emitFailure } = await import('./command-output.js');
  emitFailure(error);
}
