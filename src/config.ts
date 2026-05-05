import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from './constants.js';

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
  return path.join(getConfigDir(), 'config.json');
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

export function loadConfig(): OpenCliConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<OpenCliConfig>;
    const daemonPort = parseDaemonPort(parsed.daemon?.port);
    return {
      version: 1,
      ...(daemonPort == null ? {} : { daemon: { port: daemonPort } }),
    };
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: OpenCliConfig): void {
  const target = getConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
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
