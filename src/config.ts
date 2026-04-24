/**
 * User-level CLI config file: ~/.opencli/config.json
 *
 * Minimal JSON bag for persistent CLI preferences. Today only tracks the
 * default Chrome profile used by the Browser Bridge; kept intentionally
 * narrow so plugins can layer their own keys without fighting a schema.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.opencli');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface OpenCliConfig {
  /** Profile label or UUID the Browser Bridge should target when >1 profiles are connected. */
  defaultProfile?: string;
}

export function readConfig(): OpenCliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as OpenCliConfig;
  } catch {
    // missing / malformed — treat as empty
  }
  return {};
}

export function writeConfig(cfg: OpenCliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * Resolve the effective default profile. Precedence:
 *   1. OPENCLI_PROFILE env var (set by --profile flag or user shell)
 *   2. ~/.opencli/config.json `defaultProfile`
 *   3. null → daemon auto-routes when exactly one profile is connected
 */
export function getDefaultProfile(): string | null {
  const env = process.env.OPENCLI_PROFILE?.trim();
  if (env) return env;
  const stored = readConfig().defaultProfile?.trim();
  return stored || null;
}

export function setDefaultProfile(name: string | null): void {
  const cfg = readConfig();
  if (name === null || name === '') delete cfg.defaultProfile;
  else cfg.defaultProfile = name;
  writeConfig(cfg);
}

export { CONFIG_PATH };
