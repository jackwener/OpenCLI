import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import chalk from 'chalk';
import {
  inferUserDataKind,
  isProcessAlive,
  readLaunchRegistry,
  removeLaunchRegistryEntries,
  temporaryBrowserLaunchRoot,
  type BrowserLaunchRegistryEntry,
  type BrowserUserDataKind,
} from './instances.js';

export type BrowserProfileKind = Exclude<BrowserUserDataKind, 'unknown'>;
export type BrowserProfileStatus = 'idle' | 'in-use';

export interface BrowserProfileRecord {
  name: string;
  kind: BrowserProfileKind;
  path: string;
  status: BrowserProfileStatus;
  ports: number[];
  lastUsedAt: string;
}

export interface RemoveBrowserProfileReport {
  profileName: string;
  removed: boolean;
  removedPath?: string;
  removedRegistryEntries: number;
  issues: string[];
}

export interface PruneTemporaryProfilesReport {
  removedDirs: string[];
  removedRegistryEntries: number;
  skippedInUse: number;
  issues: string[];
}

function browserProfilesRoot(): string {
  return path.join(os.homedir(), '.opencli', 'browser-profiles');
}

export function persistentBrowserProfilesRoot(): string {
  return path.join(browserProfilesRoot(), 'named');
}

export function normalizeProfileName(raw: string): string {
  const name = raw.trim();
  if (!name) {
    throw new Error('Profile name cannot be empty.');
  }
  if (name === '.' || name === '..' || /[\\/]/.test(name) || name.includes('\0')) {
    throw new Error(`Invalid profile name: ${raw}`);
  }
  return name;
}

export function resolvePersistentProfileDir(name: string): string {
  return path.join(persistentBrowserProfilesRoot(), normalizeProfileName(name));
}

export function profileLabel(entry: {
  profileName?: string;
  userDataDir?: string;
  userDataKind: BrowserUserDataKind;
}): string {
  if (entry.profileName) return entry.profileName;
  if (entry.userDataKind === 'temporary' && entry.userDataDir) {
    return path.basename(entry.userDataDir);
  }
  return '';
}

async function listDirectoryNames(root: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

async function statMtimeIso(targetDir: string): Promise<string> {
  const stat = await fs.promises.stat(targetDir);
  return stat.mtime.toISOString();
}

function resolvedDir(targetDir: string): string {
  return path.resolve(targetDir);
}

function matchingEntries(entries: BrowserLaunchRegistryEntry[], targetDir: string): BrowserLaunchRegistryEntry[] {
  const resolved = resolvedDir(targetDir);
  return entries.filter((entry) => entry.userDataDir && resolvedDir(entry.userDataDir) === resolved);
}

function aliveEntries(entries: BrowserLaunchRegistryEntry[]): BrowserLaunchRegistryEntry[] {
  return entries.filter((entry) => isProcessAlive(entry.pid));
}

function latestKnownUsage(entries: BrowserLaunchRegistryEntry[], fallbackIso: string): string {
  const candidates = entries
    .flatMap((entry) => [entry.updatedAt, entry.createdAt])
    .filter(Boolean);

  return candidates.sort().at(-1) ?? fallbackIso;
}

async function profileRecordForDir(
  name: string,
  kind: BrowserProfileKind,
  targetDir: string,
  entries: BrowserLaunchRegistryEntry[],
): Promise<BrowserProfileRecord> {
  const fallbackIso = await statMtimeIso(targetDir);
  const profileEntries = matchingEntries(entries, targetDir);
  const live = aliveEntries(profileEntries);

  return {
    name,
    kind,
    path: resolvedDir(targetDir),
    status: live.length > 0 ? 'in-use' : 'idle',
    ports: [...new Set(live.map((entry) => entry.port))].sort((a, b) => a - b),
    lastUsedAt: latestKnownUsage(profileEntries, fallbackIso),
  };
}

function profileSortValue(kind: BrowserProfileKind): number {
  return kind === 'persistent' ? 0 : 1;
}

export async function listBrowserProfiles(): Promise<BrowserProfileRecord[]> {
  const registryEntries = await readLaunchRegistry();
  const persistentNames = await listDirectoryNames(persistentBrowserProfilesRoot());
  const temporaryNames = await listDirectoryNames(temporaryBrowserLaunchRoot());

  const persistentProfiles = await Promise.all(
    persistentNames.map((name) =>
      profileRecordForDir(name, 'persistent', resolvePersistentProfileDir(name), registryEntries),
    ),
  );

  const temporaryProfiles = await Promise.all(
    temporaryNames.map((name) =>
      profileRecordForDir(name, 'temporary', path.join(temporaryBrowserLaunchRoot(), name), registryEntries),
    ),
  );

  return [...persistentProfiles, ...temporaryProfiles].sort((a, b) => {
    if (a.kind !== b.kind) return profileSortValue(a.kind) - profileSortValue(b.kind);
    return a.name.localeCompare(b.name);
  });
}

async function removeDirIfExists(targetDir: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${targetDir}`);
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }

  await fs.promises.rm(targetDir, { recursive: true, force: true });
  return true;
}

export async function removeBrowserProfile(rawName: string): Promise<RemoveBrowserProfileReport> {
  const profileName = normalizeProfileName(rawName);
  const targetDir = resolvePersistentProfileDir(profileName);
  const registryEntries = await readLaunchRegistry();
  const matchedEntries = registryEntries.filter(
    (entry) => entry.profileName === profileName || resolvedDir(entry.userDataDir) === resolvedDir(targetDir),
  );

  if (matchedEntries.some((entry) => isProcessAlive(entry.pid))) {
    return {
      profileName,
      removed: false,
      removedRegistryEntries: 0,
      issues: [`Profile ${profileName} is currently in use. Stop the browser first.`],
    };
  }

  let removed = false;
  let removedRegistryEntries = 0;
  const issues: string[] = [];

  try {
    removed = await removeDirIfExists(targetDir);
  } catch (err: any) {
    issues.push(`Failed to remove profile ${profileName}: ${err?.message ?? String(err)}`);
  }

  if (matchedEntries.length > 0) {
    removedRegistryEntries = await removeLaunchRegistryEntries(
      (entry) => entry.profileName === profileName || resolvedDir(entry.userDataDir) === resolvedDir(targetDir),
    );
  }

  if (!removed && removedRegistryEntries === 0 && issues.length === 0) {
    issues.push(`Profile ${profileName} does not exist.`);
  }

  return {
    profileName,
    removed,
    removedPath: removed ? targetDir : undefined,
    removedRegistryEntries,
    issues,
  };
}

export async function pruneTemporaryProfiles(): Promise<PruneTemporaryProfilesReport> {
  const registryEntries = await readLaunchRegistry();
  const tempRoot = temporaryBrowserLaunchRoot();
  const tempNames = await listDirectoryNames(tempRoot);
  const tempDirs = tempNames.map((name) => path.join(tempRoot, name));
  const tempDirSet = new Set(tempDirs.map(resolvedDir));
  const activeTempDirs = new Set(
    registryEntries
      .filter((entry) => inferUserDataKind(entry.userDataDir) === 'temporary' && isProcessAlive(entry.pid))
      .map((entry) => resolvedDir(entry.userDataDir)),
  );

  const removedDirs: string[] = [];
  const issues: string[] = [];
  let skippedInUse = 0;

  for (const targetDir of tempDirs) {
    const resolved = resolvedDir(targetDir);
    if (activeTempDirs.has(resolved)) {
      skippedInUse += 1;
      continue;
    }

    try {
      const removed = await removeDirIfExists(targetDir);
      if (removed) removedDirs.push(resolved);
    } catch (err: any) {
      issues.push(`Failed to remove ${resolved}: ${err?.message ?? String(err)}`);
    }
  }

  const removedDirSet = new Set(removedDirs);
  const removedRegistryEntries = await removeLaunchRegistryEntries((entry) => {
    if (inferUserDataKind(entry.userDataDir) !== 'temporary') return false;
    if (isProcessAlive(entry.pid)) return false;
    const resolved = resolvedDir(entry.userDataDir);
    return removedDirSet.has(resolved) || !tempDirSet.has(resolved);
  });

  return {
    removedDirs,
    removedRegistryEntries,
    skippedInUse,
    issues,
  };
}

export function renderRemoveBrowserProfileReport(report: RemoveBrowserProfileReport): string {
  const lines = [chalk.bold('opencli browser profiles rm'), ''];

  if (report.removed) {
    lines.push(chalk.green(`Removed profile ${report.profileName}.`));
    if (report.removedPath) {
      lines.push(chalk.dim(`  - ${report.removedPath}`));
    }
  } else {
    lines.push(chalk.dim(`No profile directory removed for ${report.profileName}.`));
  }

  lines.push(chalk.dim(`Registry entries removed: ${report.removedRegistryEntries}`));

  if (report.issues.length > 0) {
    lines.push('', chalk.yellow('Issues:'));
    for (const issue of report.issues) {
      lines.push(chalk.dim(`  - ${issue}`));
    }
  }

  return lines.join('\n');
}

export function renderPruneTemporaryProfilesReport(report: PruneTemporaryProfilesReport): string {
  const lines = [chalk.bold('opencli browser profiles prune'), ''];

  if (report.removedDirs.length > 0) {
    lines.push(chalk.green(`Removed ${report.removedDirs.length} temporary profile director${report.removedDirs.length === 1 ? 'y' : 'ies'}.`));
    for (const dir of report.removedDirs) {
      lines.push(chalk.dim(`  - ${dir}`));
    }
  } else {
    lines.push(chalk.dim('No temporary profiles removed.'));
  }

  lines.push(chalk.dim(`In-use profiles skipped: ${report.skippedInUse}`));
  lines.push(chalk.dim(`Registry entries removed: ${report.removedRegistryEntries}`));

  if (report.issues.length > 0) {
    lines.push('', chalk.yellow('Issues:'));
    for (const issue of report.issues) {
      lines.push(chalk.dim(`  - ${issue}`));
    }
  }

  return lines.join('\n');
}
