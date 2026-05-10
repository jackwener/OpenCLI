#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all JS CLI definitions in clis/ and pre-compiles them into a single
 * manifest.json for instant cold-start registration.
 *
 * Usage: npx tsx src/build-manifest.ts [--allow-removals[=N]]
 *
 * Output: cli-manifest.json next to clis/
 *
 * Safety invariants:
 *   - Adapters whose source file does not call `cli(...)` are silently
 *     skipped (they are helpers / type modules, not commands).
 *   - Adapters that look like commands but fail to import are reported as
 *     failures, the manifest is NOT written, and the process exits 1. This
 *     prevents a stale dist or a broken adapter from silently dropping
 *     other adapters' entries (root cause of the "manifest lost 478 lines"
 *     incident).
 *   - Net-deletions vs the existing committed manifest abort the build by
 *     default; pass `--allow-removals=N` (or just `--allow-removals` for any
 *     amount) to confirm an intentional removal.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getErrorMessage } from './errors.js';
import { fullName, getRegistry, type CliCommand } from './registry.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';
import type { ManifestEntry } from './manifest-types.js';
import { isRecord } from './utils.js';

export type { ManifestEntry } from './manifest-types.js';

const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));
const CLIS_DIR = path.join(PACKAGE_ROOT, 'clis');
// Write manifest next to clis/ so both dev and installed runtime can find it.
const OUTPUT = getCliManifestPath(CLIS_DIR);

// Module is treated as a CLI command source if it either:
//   1. Calls `cli(...)` directly (the common case), or
//   2. Calls a factory `make<Pascal>Command(...)` from clis/_shared/ that
//      wraps `cli(...)`. Without (2), shared-factory adapters
//      (codex/cursor/chatwise new/status/dump/screenshot) match no `cli(`
//      token at the top level and silently drop out of the manifest.
const CLI_MODULE_PATTERN = /\bcli\s*\(|\bmake[A-Z]\w*Command\s*\(/;

/**
 * Thrown by `loadManifestEntries` when an adapter file looks like a CLI
 * module (matches CLI_MODULE_PATTERN) but cannot be imported. Callers
 * decide whether to abort or aggregate failures across the whole scan.
 */
export class ManifestImportError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: unknown,
  ) {
    super(`failed to scan ${filePath}: ${getErrorMessage(cause)}`);
    this.name = 'ManifestImportError';
  }
}

export interface BuildManifestResult {
  entries: ManifestEntry[];
  /** Adapters that look like CLI modules but failed to import. */
  failures: ManifestImportError[];
}

export interface BuildManifestArgs {
  /** Maximum number of entries that may be removed vs the existing manifest.
   *  `Number.POSITIVE_INFINITY` disables the safety net entirely. */
  allowRemovals: number;
}

function toManifestArgs(args: CliCommand['args']): ManifestEntry['args'] {
  return args.map(arg => ({
    name: arg.name,
    type: arg.type ?? 'str',
    default: arg.default,
    required: !!arg.required,
    valueRequired: !!arg.valueRequired || undefined,
    positional: arg.positional || undefined,
    help: arg.help ?? '',
    choices: arg.choices,
  }));
}

function toModulePath(filePath: string, site: string): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  return `${site}/${baseName}.js`;
}

export function normalizeManifestPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

function toManifestRelativePath(filePath: string, clisDir: string): string {
  return normalizeManifestPath(path.relative(clisDir, filePath));
}

function isCliCommandValue(value: unknown, site: string): value is CliCommand {
  return isRecord(value)
    && typeof value.site === 'string'
    && value.site === site
    && typeof value.name === 'string'
    && (value.access === 'read' || value.access === 'write')
    && Array.isArray(value.args);
}

function toManifestEntry(cmd: CliCommand, modulePath: string, sourceFile?: string): ManifestEntry {
  return {
    site: cmd.site,
    name: cmd.name,
    aliases: cmd.aliases,
    description: cmd.description ?? '',
    access: cmd.access,
    example: cmd.example,
    domain: cmd.domain,
    strategy: (cmd.strategy ?? 'public').toString().toLowerCase(),
    browser: cmd.browser ?? true,
    args: toManifestArgs(cmd.args),
    columns: cmd.columns,
    defaultFormat: cmd.defaultFormat,
    type: 'js',
    modulePath,
    sourceFile,
    navigateBefore: cmd.navigateBefore,
    siteSession: cmd.siteSession,
  };
}

/**
 * Load all manifest entries from a single adapter file.
 *
 * Returns `[]` for files that do not register a CLI command (helpers, types).
 * Throws `ManifestImportError` when a file looks like a CLI module but its
 * import or post-import processing fails — callers must decide whether to
 * surface or aggregate the failure.
 *
 * The third argument `clisDir` is used to compute the POSIX-style
 * `sourceFile` relative path; it defaults to the package's `clis/` dir so
 * existing test callers stay backward-compatible.
 */
export async function loadManifestEntries(
  filePath: string,
  site: string,
  importer: (moduleHref: string) => Promise<unknown> = moduleHref => import(moduleHref),
  clisDir: string = CLIS_DIR,
): Promise<ManifestEntry[]> {
  let src: string;
  try {
    src = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ManifestImportError(filePath, err);
  }

  // Helper / test modules that do not call cli() are not commands.
  if (!CLI_MODULE_PATTERN.test(src)) return [];

  try {
    const modulePath = toModulePath(filePath, site);
    const registry = getRegistry();
    const before = new Map(registry.entries());
    const mod = await importer(pathToFileURL(filePath).href);

    const exportedCommands = Object.values(isRecord(mod) ? mod : {})
      .filter(value => isCliCommandValue(value, site));

    const runtimeCommands = exportedCommands.length > 0
      ? exportedCommands
      : [...registry.entries()]
        .filter(([key, cmd]) => {
          if (cmd.site !== site) return false;
          const previous = before.get(key);
          return !previous || previous !== cmd;
        })
        .map(([, cmd]) => cmd);

    // Manifest paths are cross-platform artifacts; keep them POSIX-style even
    // when build-manifest runs on Windows.
    const sourceRelative = toManifestRelativePath(filePath, clisDir);

    const seen = new Set<string>();
    return runtimeCommands
      .filter((cmd) => {
        const key = fullName(cmd);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cmd => toManifestEntry(cmd, modulePath, sourceRelative));
  } catch (err) {
    throw new ManifestImportError(filePath, err);
  }
}

/**
 * Scan a `clis/` directory and aggregate per-adapter results. Import
 * failures are collected in `failures` instead of crashing the whole scan,
 * but the caller (e.g. `main()`) is expected to fail loud if any failure
 * is present.
 */
export async function scanClisDir(
  clisDir: string,
  importer: (moduleHref: string) => Promise<unknown> = moduleHref => import(moduleHref),
): Promise<BuildManifestResult> {
  const manifest = new Map<string, ManifestEntry>();
  const failures: ManifestImportError[] = [];

  if (!fs.existsSync(clisDir)) {
    return { entries: [], failures };
  }

  for (const site of fs.readdirSync(clisDir)) {
    const siteDir = path.join(clisDir, site);
    if (!fs.statSync(siteDir).isDirectory()) continue;
    for (const file of fs.readdirSync(siteDir)) {
      if (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js') && file !== 'index.js') {
        const filePath = path.join(siteDir, file);
        try {
          const entries = await loadManifestEntries(filePath, site, importer, clisDir);
          for (const entry of entries) {
            const key = `${entry.site}/${entry.name}`;
            manifest.set(key, entry);
          }
        } catch (err) {
          if (err instanceof ManifestImportError) {
            failures.push(err);
            continue;
          }
          throw err;
        }
      }
    }
  }

  const entries = [...manifest.values()].sort(
    (a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name),
  );
  return { entries, failures };
}

export async function buildManifest(): Promise<BuildManifestResult> {
  return scanClisDir(CLIS_DIR);
}

export function serializeManifest(manifest: ManifestEntry[]): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Metadata audit: every positional arg must carry a non-empty `help` string.
 *
 * Why this is a hard gate (not advisory):
 *   - `opencli twitter followers --help` rendered `Arguments:\n  user  ` with
 *     an empty trailing column. Agents and humans both saw a blank field —
 *     impossible to recover the parameter's purpose without reading source.
 *   - This is metadata completeness, not stylistic taste; failing closed is
 *     the only way to keep the help surface trustworthy as adapters land.
 *
 * Note: semantic quality (e.g. "what does the optional positional mean when
 * omitted?") is intentionally NOT enforced here. That belongs to a follow-up
 * advisory audit — see PR plan `Arg metadata v2` for the structured
 * `when_omitted / when_present / value_format` schema.
 */
export interface ManifestMetadataIssue {
  site: string;
  command: string;
  arg: string;
  sourceFile?: string;
  reason: string;
}

export function findManifestMetadataIssues(
  entries: readonly ManifestEntry[],
): ManifestMetadataIssue[] {
  const issues: ManifestMetadataIssue[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.args)) continue;
    for (const arg of entry.args) {
      if (!arg.positional) continue;
      const help = typeof arg.help === 'string' ? arg.help.trim() : '';
      if (help === '') {
        issues.push({
          site: entry.site,
          command: entry.name,
          arg: arg.name,
          sourceFile: entry.sourceFile,
          reason: 'positional arg missing non-empty `help` text',
        });
      }
    }
  }
  return issues;
}

/**
 * Diff helper: returns site/name keys that exist in `prev` but not in
 * `next`. Used as a safety net to detect accidental mass-deletions caused
 * by silently failing adapter imports.
 */
export function diffRemovedEntries(
  prev: readonly ManifestEntry[],
  next: readonly ManifestEntry[],
): string[] {
  const nextKeys = new Set(next.map(e => `${e.site}/${e.name}`));
  return prev
    .map(e => `${e.site}/${e.name}`)
    .filter(key => !nextKeys.has(key))
    .sort();
}

/**
 * Parse `--allow-removals` and `--allow-removals=N` from argv.
 * Bare `--allow-removals` disables the safety net (`Infinity`); the
 * numeric form sets an explicit upper bound.
 */
export function parseBuildManifestArgs(argv: readonly string[]): BuildManifestArgs {
  let allowRemovals = 0;
  for (const arg of argv) {
    if (arg === '--allow-removals') {
      allowRemovals = Number.POSITIVE_INFINITY;
      continue;
    }
    const m = arg.match(/^--allow-removals=(\d+)$/);
    if (m) {
      allowRemovals = Number.parseInt(m[1], 10);
      continue;
    }
  }
  return { allowRemovals };
}

function readExistingManifest(filePath: string): ManifestEntry[] | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ManifestEntry[] : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // Runtime guard: refuse to run from dist/. tsc transitively emits this
  // file (the test file imports from it) so dist/src/build-manifest.js
  // physically exists. If a developer or agent runs that compiled copy,
  // any stale dist will silently break adapter imports — the exact failure
  // mode this script is meant to prevent. Direct them at the tsx entry
  // before they can shoot themselves in the foot.
  if (fileURLToPath(import.meta.url).includes(`${path.sep}dist${path.sep}`)) {
    process.stderr.write(
      `❌ Refusing to run build-manifest from dist/.\n`
      + `   Stale compiled output silently drops adapters that import renamed/removed exports.\n`
      + `   Run \`npm run build-manifest\` (or \`tsx src/build-manifest.ts\`) from the source tree instead.\n`,
    );
    process.exit(1);
  }

  const args = parseBuildManifestArgs(process.argv.slice(2));
  const { entries, failures } = await buildManifest();

  if (failures.length > 0) {
    process.stderr.write(`❌ ${failures.length} adapter(s) failed to load:\n`);
    for (const failure of failures) {
      const rel = path.relative(PACKAGE_ROOT, failure.filePath) || failure.filePath;
      process.stderr.write(`  - ${rel}: ${getErrorMessage(failure.cause)}\n`);
    }
    process.stderr.write(
      `\nManifest NOT written. Likely cause: stale dist/ or a broken adapter import.\n`
      + `Always run via tsx (\`npm run build-manifest\`), not against compiled dist/.\n`,
    );
    process.exit(1);
  }

  const metadataIssues = findManifestMetadataIssues(entries);
  if (metadataIssues.length > 0) {
    process.stderr.write(
      `❌ ${metadataIssues.length} positional arg(s) missing \`help\` text:\n`,
    );
    for (const issue of metadataIssues) {
      const where = issue.sourceFile ? ` (${issue.sourceFile})` : '';
      process.stderr.write(
        `  - ${issue.site}/${issue.command} positional "${issue.arg}"${where}\n`,
      );
    }
    process.stderr.write(
      `\nEvery positional arg must declare a non-empty \`help\` string so\n`
      + `\`opencli <site> <cmd> --help\` shows callers what the parameter is for.\n`
      + `Add \`help: '...'\` to each arg above and re-run the build.\n`,
    );
    process.exit(1);
  }

  const existing = readExistingManifest(OUTPUT);
  if (existing) {
    const removed = diffRemovedEntries(existing, entries);
    if (removed.length > args.allowRemovals) {
      process.stderr.write(
        `❌ ${removed.length} manifest entries would be removed; refusing to overwrite.\n`,
      );
      const preview = removed.slice(0, 20);
      for (const key of preview) process.stderr.write(`  - ${key}\n`);
      if (removed.length > preview.length) {
        process.stderr.write(`  ... ${removed.length - preview.length} more\n`);
      }
      process.stderr.write(
        `\nIf this removal is intentional, rerun with `
        + `\`--allow-removals=${removed.length}\` (or \`--allow-removals\` to disable the check).\n`,
      );
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, serializeManifest(entries));
  console.log(`✅ Manifest compiled: ${entries.length} entries → ${OUTPUT}`);

  // Restore executable permissions on bin entries.
  // tsc does not preserve the +x bit, so after a clean rebuild the CLI
  // entry-point loses its executable permission, causing "Permission denied".
  // See: https://github.com/jackwener/opencli/issues/446
  if (process.platform !== 'win32') {
    const projectRoot = PACKAGE_ROOT;
    const pkgPath = path.resolve(projectRoot, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const bins: Record<string, string> = typeof pkg.bin === 'string'
        ? { [pkg.name ?? 'cli']: pkg.bin }
        : pkg.bin ?? {};
      for (const binPath of Object.values(bins)) {
        const abs = path.resolve(projectRoot, binPath);
        if (fs.existsSync(abs)) {
          fs.chmodSync(abs, 0o755);
          console.log(`✅ Restored executable permission: ${binPath}`);
        }
      }
    } catch {
      // Best-effort; never break the build for a permission fix.
    }
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  void main();
}
