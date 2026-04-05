#!/usr/bin/env node
/**
 * Build-time CLI manifest compiler.
 *
 * Scans all YAML/TS CLI definitions and pre-compiles them into a single
 * manifest.json for instant cold-start registration (no runtime YAML parsing).
 *
 * Usage: npx tsx src/build-manifest.ts
 * Output: cli-manifest.json at the package root
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { getErrorMessage } from './errors.js';
import { fullName, getRegistry, type CliCommand } from './registry.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';

const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));
const CLIS_DIR = path.join(PACKAGE_ROOT, 'clis');
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
  /** 'yaml' or 'ts' — determines how executeCommand loads the handler */
  type: 'yaml' | 'ts';
  /** Relative path from clis/ dir, e.g. 'bilibili/hot.yaml' or 'bilibili/search.js' */
  modulePath?: string;
  /** Pre-navigation control — see CliCommand.navigateBefore */
  navigateBefore?: boolean | string;
}

import { type YamlCliDefinition, parseYamlArgs } from './yaml-schema.js';

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

function toTsModulePath(filePath: string, site: string): string {
  const baseName = path.basename(filePath, path.extname(filePath));
  return `${site}/${baseName}.js`;
}

function isCliCommandValue(value: unknown, site: string): value is CliCommand {
  return isRecord(value)
    && typeof value.site === 'string'
    && value.site === site
    && typeof value.name === 'string'
    && Array.isArray(value.args);
}

function toManifestEntry(cmd: CliCommand, modulePath: string): ManifestEntry {
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
    type: 'ts',
    modulePath,
    navigateBefore: cmd.navigateBefore,
  };
}

function scanYaml(filePath: string, site: string): ManifestEntry | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw) as YamlCliDefinition | null;
    if (!isRecord(def)) return null;
    const cliDef = def as YamlCliDefinition;

    const strategyStr = cliDef.strategy ?? (cliDef.browser === false ? 'public' : 'cookie');
    const strategy = strategyStr.toUpperCase();
    const browser = cliDef.browser ?? (strategy !== 'PUBLIC');

    const args = parseYamlArgs(cliDef.args);

    return {
      site: cliDef.site ?? site,
      name: cliDef.name ?? path.basename(filePath, path.extname(filePath)),
      description: cliDef.description ?? '',
      domain: cliDef.domain,
      strategy: strategy.toLowerCase(),
      browser,
      aliases: isRecord(cliDef) && Array.isArray((cliDef as Record<string, unknown>).aliases)
        ? ((cliDef as Record<string, unknown>).aliases as unknown[]).filter((value): value is string => typeof value === 'string')
        : undefined,
      args,
      columns: cliDef.columns,
      pipeline: cliDef.pipeline,
      timeout: cliDef.timeout,
      deprecated: (cliDef as Record<string, unknown>).deprecated as boolean | string | undefined,
      replacedBy: (cliDef as Record<string, unknown>).replacedBy as string | undefined,
      type: 'yaml',
      navigateBefore: cliDef.navigateBefore,
    };
  } catch (err) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${getErrorMessage(err)}\n`);
    return null;
  }
}

export async function loadTsManifestEntries(
  filePath: string,
  site: string,
  importer: (moduleHref: string) => Promise<unknown> = moduleHref => import(moduleHref),
): Promise<ManifestEntry[]> {
  try {
    const src = fs.readFileSync(filePath, 'utf-8');

    // Helper/test modules should not appear as CLI commands in the manifest.
    if (!CLI_MODULE_PATTERN.test(src)) return [];

    const modulePath = toTsModulePath(filePath, site);
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

    const seen = new Set<string>();
    return runtimeCommands
      .filter((cmd) => {
        const key = fullName(cmd);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cmd => toManifestEntry(cmd, modulePath));
  } catch (err) {
    // If parsing fails, log a warning (matching scanYaml behaviour) and skip the entry.
    process.stderr.write(`Warning: failed to scan ${filePath}: ${getErrorMessage(err)}\n`);
    return [];
  }
}

/**
 * When both YAML and TS adapters exist for the same site/name,
 * prefer the TS version (it self-registers and typically has richer logic).
 */
export function shouldReplaceManifestEntry(current: ManifestEntry, next: ManifestEntry): boolean {
  if (current.type === next.type) return false;
  return current.type === 'yaml' && next.type === 'ts';
}

export async function buildManifest(): Promise<ManifestEntry[]> {
  const manifest = new Map<string, ManifestEntry>();

  if (fs.existsSync(CLIS_DIR)) {
    for (const site of fs.readdirSync(CLIS_DIR)) {
      const siteDir = path.join(CLIS_DIR, site);
      if (!fs.statSync(siteDir).isDirectory()) continue;
      for (const file of fs.readdirSync(siteDir)) {
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          const entry = scanYaml(filePath, site);
          if (entry) {
            const key = `${entry.site}/${entry.name}`;
            const existing = manifest.get(key);
            if (!existing || shouldReplaceManifestEntry(existing, entry)) {
              if (existing && existing.type !== entry.type) {
                process.stderr.write(`⚠️  Duplicate adapter ${key}: ${existing.type} superseded by ${entry.type}\n`);
              }
              manifest.set(key, entry);
            }
          }
        } else if (
          (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && file !== 'index.ts') ||
          (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js') && file !== 'index.js')
        ) {
          const entries = await loadTsManifestEntries(filePath, site);
          for (const entry of entries) {
            const key = `${entry.site}/${entry.name}`;
            const existing = manifest.get(key);
            if (!existing || shouldReplaceManifestEntry(existing, entry)) {
              if (existing && existing.type !== entry.type) {
                process.stderr.write(`⚠️  Duplicate adapter ${key}: ${existing.type} superseded by ${entry.type}\n`);
              }
              manifest.set(key, entry);
            }
          }
        }
      }
    }
  }

  return [...manifest.values()].sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));
}

async function main(): Promise<void> {
  const manifest = await buildManifest();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2));

  const yamlCount = manifest.filter(e => e.type === 'yaml').length;
  const tsCount = manifest.filter(e => e.type === 'ts').length;
  console.log(`✅ Manifest compiled: ${manifest.length} entries (${yamlCount} YAML, ${tsCount} TS) → ${OUTPUT}`);

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
