import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_DAEMON_PORT } from './constants.js';

export type OpenCliConfig = {
  daemon?: {
    port?: number;
  };
  browser?: {
    connect_timeout?: number;
    command_timeout?: number;
    cdp_endpoint?: string;
  };
};

export const SUPPORTED_CONFIG_KEYS = [
  'daemon.port',
  'browser.connect_timeout',
  'browser.command_timeout',
  'browser.cdp_endpoint',
] as const;
export type SupportedConfigKey = typeof SUPPORTED_CONFIG_KEYS[number];

export const DEFAULT_BROWSER_CONNECT_TIMEOUT_SECONDS = 30;
export const DEFAULT_BROWSER_COMMAND_TIMEOUT_SECONDS = 60;

export function getConfigDir(): string {
  return path.join(os.homedir(), '.opencli');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

export function emptyConfig(): OpenCliConfig {
  return {};
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

export function parsePositiveInt(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') return null;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseConfigString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseConfigYaml(raw: string): OpenCliConfig {
  const parsed = objectRecord(yaml.load(raw));
  const daemon = objectRecord(parsed.daemon);
  const browser = objectRecord(parsed.browser);
  const daemonPort = parseDaemonPort(daemon.port);
  const connectTimeout = parsePositiveInt(browser.connect_timeout);
  const commandTimeout = parsePositiveInt(browser.command_timeout);
  const cdpEndpoint = parseConfigString(browser.cdp_endpoint);
  return {
    ...(daemonPort == null ? {} : { daemon: { port: daemonPort } }),
    ...(connectTimeout == null && commandTimeout == null && cdpEndpoint == null
      ? {}
      : {
          browser: {
            ...(connectTimeout == null ? {} : { connect_timeout: connectTimeout }),
            ...(commandTimeout == null ? {} : { command_timeout: commandTimeout }),
            ...(cdpEndpoint == null ? {} : { cdp_endpoint: cdpEndpoint }),
          },
        }),
  };
}

export function serializeConfigYaml(config: OpenCliConfig): string {
  if (!config.daemon && !config.browser) return '';
  return yaml.dump(config, { lineWidth: 120, noRefs: true, sortKeys: false });
}

export function loadConfig(): OpenCliConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return parseConfigYaml(raw);
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: OpenCliConfig): void {
  const target = getConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, serializeConfigYaml(config), 'utf-8');
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

export function getConfiguredBrowserConnectTimeout(): number {
  return loadConfig().browser?.connect_timeout ?? DEFAULT_BROWSER_CONNECT_TIMEOUT_SECONDS;
}

export function getConfiguredBrowserCommandTimeout(): number {
  return loadConfig().browser?.command_timeout ?? DEFAULT_BROWSER_COMMAND_TIMEOUT_SECONDS;
}

export function getConfiguredCdpEndpoint(): string | undefined {
  return loadConfig().browser?.cdp_endpoint;
}

export function getConfigValue(key: SupportedConfigKey): number | string | undefined {
  if (key === 'daemon.port') return getConfiguredDaemonPort();
  if (key === 'browser.connect_timeout') return getConfiguredBrowserConnectTimeout();
  if (key === 'browser.command_timeout') return getConfiguredBrowserCommandTimeout();
  if (key === 'browser.cdp_endpoint') return getConfiguredCdpEndpoint();
  key satisfies never;
  return undefined;
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
  if (key === 'browser.connect_timeout' || key === 'browser.command_timeout') {
    const timeout = parsePositiveInt(value);
    if (timeout == null) throw new Error(`${key} must be a positive integer`);
    const browserKey = key === 'browser.connect_timeout' ? 'connect_timeout' : 'command_timeout';
    const config = loadConfig();
    config.browser = { ...(config.browser ?? {}), [browserKey]: timeout };
    saveConfig(config);
    return config;
  }
  if (key === 'browser.cdp_endpoint') {
    const endpoint = parseConfigString(value);
    if (endpoint == null) throw new Error('browser.cdp_endpoint must be a non-empty string');
    const config = loadConfig();
    config.browser = { ...(config.browser ?? {}), cdp_endpoint: endpoint };
    saveConfig(config);
    return config;
  }
  key satisfies never;
  return loadConfig();
}

export function unsetConfigValue(key: SupportedConfigKey): OpenCliConfig {
  const config = loadConfig();
  if (key === 'daemon.port') {
    if (config.daemon) {
      delete config.daemon.port;
      if (Object.keys(config.daemon).length === 0) delete config.daemon;
    }
    saveConfig(config);
    return config;
  }
  if (key === 'browser.connect_timeout' || key === 'browser.command_timeout') {
    if (config.browser) {
      const browserKey = key === 'browser.connect_timeout' ? 'connect_timeout' : 'command_timeout';
      delete config.browser[browserKey];
      if (Object.keys(config.browser).length === 0) delete config.browser;
    }
    saveConfig(config);
    return config;
  }
  if (key === 'browser.cdp_endpoint') {
    if (config.browser) {
      delete config.browser.cdp_endpoint;
      if (Object.keys(config.browser).length === 0) delete config.browser;
    }
    saveConfig(config);
    return config;
  }
  key satisfies never;
  return loadConfig();
}
