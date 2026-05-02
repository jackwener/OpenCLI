#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all JS CLI definitions in clis/ and pre-compiles them into a single
 * manifest.json for instant cold-start registration.
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: cli-manifest.json next to clis/
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getErrorMessage } from './errors.js';
import { fullName, getRegistry, type CliCommand } from './registry.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';

const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));
const CLIS_DIR = path.join(PACKAGE_ROOT, 'clis');
// Write manifest next to clis/ so both dev and installed runtime can find it.
const OUTPUT = getCliManifestPath(CLIS_DIR);

export interface ManifestEntry {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    valueRequired?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
  }>;
  columns?: string[];
  pipeline?: Record<string, unknown>[];
  timeout?: number;
  deprecated?: boolean | string;
  replacedBy?: string;
  type: 'js';
  /** Relative path from clis/ dir, e.g. 'bilibili/search.js' */
  modulePath?: string;
  /** Relative path to the source file from clis/ dir (e.g. 'site/cmd.js') */
  sourceFile?: string;
  /** Pre-navigation control — see CliCommand.navigateBefore */
  navigateBefore?: boolean | string;
}

import { isRecord } from './utils.js';

const CLI_MODULE_PATTERN = /\bcli\s*\(/;

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

function toManifestRelativePath(filePath: string): string {
  return normalizeManifestPath(path.relative(CLIS_DIR, filePath));
}

function isCliCommandValue(value: unknown, site: string): value is CliCommand {
  return isRecord(value)
    && typeof value.site === 'string'
    && value.site === site
    && typeof value.name === 'string'
    && Array.isArray(value.args);
}

function toManifestEntry(cmd: CliCommand, modulePath: string, sourceFile?: string): ManifestEntry {
  return {
    site: cmd.site,
    name: cmd.name,
    aliases: cmd.aliases,
    description: cmd.description ?? '',
    domain: cmd.domain,
    strategy: (cmd.strategy ?? 'public').toString().toLowerCase(),
    browser: cmd.browser ?? true,
    args: toManifestArgs(cmd.args),
    columns: cmd.columns,
    timeout: cmd.timeoutSeconds,
    deprecated: cmd.deprecated,
    replacedBy: cmd.replacedBy,
    type: 'js',
    modulePath,
    sourceFile,
    navigateBefore: cmd.navigateBefore,
  };
}

export async function loadManifestEntries(
  filePath: string,
  site: string,
  importer: (moduleHref: string) => Promise<unknown> = moduleHref => import(moduleHref),
): Promise<ManifestEntry[]> {
  try {
    const src = fs.readFileSync(filePath, 'utf-8');

    // Helper/test modules should not appear as CLI commands in the manifest.
    if (!CLI_MODULE_PATTERN.test(src)) return [];

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
    const sourceRelative = toManifestRelativePath(filePath);

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
    // If parsing fails, log a warning (matching scanYaml behaviour) and skip the entry.
    process.stderr.write(`Warning: failed to scan ${filePath}: ${getErrorMessage(err)}\n`);
    return [];
  }
}

export async function buildManifest(): Promise<ManifestEntry[]> {
  const manifest = new Map<string, ManifestEntry>();

  // Scan JS adapters directly from clis/.
  // Adapters are now JS-first — no compilation step needed.
  if (fs.existsSync(CLIS_DIR)) {
    for (const site of fs.readdirSync(CLIS_DIR)) {
      const siteDir = path.join(CLIS_DIR, site);
      if (!fs.statSync(siteDir).isDirectory()) continue;
      for (const file of fs.readdirSync(siteDir)) {
        if (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js') && file !== 'index.js') {
          const filePath = path.join(siteDir, file);
          const entries = await loadManifestEntries(filePath, site);
          for (const entry of entries) {
            const key = `${entry.site}/${entry.name}`;
            manifest.set(key, entry);
          }
        }
      }
    }
  }

  return [...manifest.values()].sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
}

export function serializeManifest(manifest: ManifestEntry[]): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main(): Promise<void> {
  const manifest = await buildManifest();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, serializeManifest(manifest));

  console.log(`✅ Manifest compiled: ${manifest.length} entries → ${OUTPUT}`);

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
