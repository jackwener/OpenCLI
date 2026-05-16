/**
 * Electron app registry — maps site names to launch metadata.
 *
 * Builtin apps are defined here. User-defined apps are loaded
 * from ~/.opencli/apps.yaml (additive only, does not override builtins).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import yaml from 'js-yaml';

export interface ElectronAppEntry {
  /** CDP debug port (unique per app) */
  port: number;
  /** macOS process name for detection via pgrep */
  processName: string;
  /** Candidate executable names inside Contents/MacOS/, tried in order */
  executableNames?: string[];
  /** macOS bundle ID for path discovery */
  bundleId?: string;
  /** Human-readable name for prompts */
  displayName?: string;
  /** Additional launch args beyond --remote-debugging-port */
  extraArgs?: string[];
}

export const builtinApps: Record<string, ElectronAppEntry> = {
  cursor:        { port: 9226, processName: 'Cursor',      bundleId: 'com.todesktop.runtime.Cursor',   displayName: 'Cursor' },
  codex:         { port: 9222, processName: 'Codex',        bundleId: 'com.openai.codex',               displayName: 'Codex' },
  chatwise:      { port: 9228, processName: 'ChatWise',     bundleId: 'com.chatwise.app',               displayName: 'ChatWise' },
  'discord-app': { port: 9232, processName: 'Discord',      bundleId: 'com.discord.app',                 displayName: 'Discord' },
  'doubao-app':  { port: 9225, processName: 'Doubao',       bundleId: 'com.volcengine.doubao',          displayName: 'Doubao' },
  antigravity:   {
    port: 9234,
    processName: 'Antigravity',
    executableNames: ['Electron', 'Antigravity'],
    bundleId: 'dev.antigravity.app',
    displayName: 'Antigravity',
  },
  'chatgpt-app': { port: 9236, processName: 'ChatGPT',      bundleId: 'com.openai.chat',                displayName: 'ChatGPT' },
};

/** Merge builtin + user-defined apps. User entries are additive only. */
export function loadApps(
  userApps?: Record<string, Omit<ElectronAppEntry, 'displayName'> & { displayName?: string }>,
): Record<string, ElectronAppEntry> {
  const merged = { ...builtinApps };
  if (userApps) {
    for (const [name, entry] of Object.entries(userApps)) {
      if (!(name in merged)) {
        merged[name] = entry as ElectronAppEntry;
      }
    }
  }
  return merged;
}

let _apps: Record<string, ElectronAppEntry> | null = null;

function ensureLoaded(): Record<string, ElectronAppEntry> {
  if (_apps) return _apps;

  let userApps: Record<string, ElectronAppEntry> | undefined;
  try {
    const yamlPath = path.join(os.homedir(), '.opencli', 'apps.yaml');
    if (fs.existsSync(yamlPath)) {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const parsed = yaml.load(content) as { apps?: Record<string, ElectronAppEntry> };
      userApps = parsed?.apps;
    }
  } catch {
    // Silently ignore malformed user config
  }

  _apps = loadApps(userApps);
  return _apps;
}

export function getElectronApp(site: string): ElectronAppEntry | undefined {
  return ensureLoaded()[site];
}

export function isElectronApp(site: string): boolean {
  return site in ensureLoaded();
}

/** Get all registered apps (builtin + user-defined). */
export function getAllElectronApps(): Record<string, ElectronAppEntry> {
  return ensureLoaded();
}

/** Reset loaded apps (for testing). */
export function _resetRegistry(): void {
  _apps = null;
}
