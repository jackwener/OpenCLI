import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManifestEntry } from './manifest-types.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';

export type AdapterShadow = {
  name: string;
  userPath: string;
  builtinPath: string;
};

export type AdapterShadowOptions = {
  userClisDir?: string;
  builtinClisDir?: string;
};

function defaultBuiltinClisDir(): string {
  return path.join(findPackageRoot(fileURLToPath(import.meta.url)), 'clis');
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function loadBuiltinCommandFiles(builtinClisDir: string): Set<string> {
  try {
    const raw = fs.readFileSync(getCliManifestPath(builtinClisDir), 'utf-8');
    const entries = JSON.parse(raw) as ManifestEntry[];
    const files = new Set<string>();
    for (const entry of entries) {
      const rel = entry.sourceFile ?? entry.modulePath;
      if (rel) files.add(path.resolve(builtinClisDir, rel));
    }
    return files;
  } catch {
    return new Set();
  }
}

export function findShadowedUserAdapters(opts: AdapterShadowOptions = {}): AdapterShadow[] {
  const userClisDir = opts.userClisDir ?? path.join(os.homedir(), '.opencli', 'clis');
  const builtinClisDir = opts.builtinClisDir ?? defaultBuiltinClisDir();
  const builtinCommandFiles = loadBuiltinCommandFiles(builtinClisDir);
  const shadows: AdapterShadow[] = [];

  for (const siteEntry of safeReaddir(userClisDir)) {
    if (!siteEntry.isDirectory()) continue;
    const site = siteEntry.name;
    const userSiteDir = path.join(userClisDir, site);
    const builtinSiteDir = path.join(builtinClisDir, site);

    for (const commandEntry of safeReaddir(userSiteDir)) {
      if (!commandEntry.isFile() || !commandEntry.name.endsWith('.js')) continue;
      const userPath = path.join(userSiteDir, commandEntry.name);
      const builtinPath = path.join(builtinSiteDir, commandEntry.name);
      const builtinResolved = path.resolve(builtinPath);
      if (!builtinCommandFiles.has(builtinResolved)) continue;

      shadows.push({
        name: `${site}/${commandEntry.name.replace(/\.js$/, '')}`,
        userPath,
        builtinPath,
      });
    }
  }

  return shadows.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatAdapterShadowIssue(shadows: AdapterShadow[]): string {
  const visible = shadows.slice(0, 10);
  const lines = ['Local adapter overrides shadow packaged adapters:'];
  for (const shadow of visible) {
    lines.push(`  ${shadow.name}: ${shadow.userPath} overrides ${shadow.builtinPath}`);
  }
  if (shadows.length > visible.length) {
    lines.push(`  ... and ${shadows.length - visible.length} more`);
  }
  lines.push('Remove the local ~/.opencli/clis copy, or run opencli adapter reset <site>, when you want packaged updates.');
  return lines.join('\n');
}
