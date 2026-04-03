import * as os from 'node:os';
import * as path from 'node:path';

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Shared placement policy for user-level OpenCLI runtime state.
 *
 * Anything that belongs to the user's long-lived runtime environment should
 * live under ~/.opencli rather than the caller's current working directory.
 */
export function getUserOpenCliDir(): string {
  return path.join(getHomeDir(), '.opencli');
}

export function getUserOpenCliPath(...segments: string[]): string {
  return path.join(getUserOpenCliDir(), ...segments);
}

export const USER_OPENCLI_DIR = getUserOpenCliDir();
export const USER_CLIS_DIR = getUserOpenCliPath('clis');
export const USER_PLUGINS_DIR = getUserOpenCliPath('plugins');
export const USER_MONOREPOS_DIR = getUserOpenCliPath('monorepos');
export const USER_EXPLORE_DIR = getUserOpenCliPath('explore');
export const USER_RECORD_DIR = getUserOpenCliPath('record');

export function getUserCliDir(site: string): string {
  return getUserOpenCliPath('clis', site);
}

export function getUserPluginDir(name: string): string {
  return getUserOpenCliPath('plugins', name);
}

export function getUserExploreDir(site: string): string {
  return path.join(USER_EXPLORE_DIR, site);
}

export function getUserRecordDir(site: string): string {
  return path.join(USER_RECORD_DIR, site);
}

export function getUserAppsConfigPath(): string {
  return getUserOpenCliPath('apps.yaml');
}

export function getUserExternalClisConfigPath(): string {
  return getUserOpenCliPath('external-clis.yaml');
}

export function getUserPluginLockFilePath(): string {
  return getUserOpenCliPath('plugins.lock.json');
}

export function getUserUpdateCheckCachePath(): string {
  return getUserOpenCliPath('update-check.json');
}
