import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from './constants.js';

// Hand-rolled TOML is intentionally limited to [daemon].port. Switch to a TOML
// library before adding more sections or string/path values.
export type OpenCliConfig = {
  version: 1;
  daemon?: {
    port?: number;
  };
};

export const SUPPORTED_CONFIG_KEYS = ['daemon.port'] as const;
export type SupportedConfigKey = typeof SUPPORTED_CONFIG_KEYS[number];

export function getConfigDir(): string {
  return path.join(os.homedir(), '.opencli');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.toml');
}

export function emptyConfig(): OpenCliConfig {
  return { version: 1 };
}

export function isSupportedConfigKey(key: string): key is SupportedConfigKey {
  return (SUPPORTED_CONFIG_KEYS as readonly string[]).includes(key);
}

export function parseDaemonPort(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return null;
  const port = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function stripTomlComment(value: string): string {
  const hash = value.indexOf('#');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

export function parseConfigToml(raw: string): OpenCliConfig {
  let section = '';
  let daemonPort: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== 'daemon') continue;
    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!assignment) continue;
    if (assignment[1] === 'port') daemonPort = parseDaemonPort(stripTomlComment(assignment[2]));
  }
  return {
    version: 1,
    ...(daemonPort == null ? {} : { daemon: { port: daemonPort } }),
  };
}

export function serializeConfigToml(config: OpenCliConfig): string {
  const lines: string[] = [];
  if (config.daemon?.port != null) {
    lines.push('[daemon]', `port = ${config.daemon.port}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function loadConfig(): OpenCliConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return parseConfigToml(raw);
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: OpenCliConfig): void {
  const target = getConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, serializeConfigToml(config), 'utf-8');
    fs.renameSync(tmp, target);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch {
      // Best-effort cleanup only; the config target is already atomic.
    }
  }
}

export function getConfiguredDaemonPort(): number {
  return loadConfig().daemon?.port ?? DEFAULT_DAEMON_PORT;
}

export function getConfigValue(key: SupportedConfigKey): number {
  if (key === 'daemon.port') return getConfiguredDaemonPort();
  key satisfies never;
  return DEFAULT_DAEMON_PORT;
}

export function setConfigValue(key: SupportedConfigKey, value: unknown): OpenCliConfig {
  if (key === 'daemon.port') {
    const port = parseDaemonPort(value);
    if (port == null) throw new Error('daemon.port must be an integer between 1 and 65535');
    const config = loadConfig();
    config.daemon = { ...(config.daemon ?? {}), port };
    saveConfig(config);
    return config;
  }
  key satisfies never;
  return loadConfig();
}

export function unsetConfigValue(key: SupportedConfigKey): OpenCliConfig {
  if (key === 'daemon.port') {
    const config = loadConfig();
    if (config.daemon) {
      delete config.daemon.port;
      if (Object.keys(config.daemon).length === 0) delete config.daemon;
    }
    saveConfig(config);
    return config;
  }
  key satisfies never;
  return loadConfig();
}
