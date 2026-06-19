import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { ConfigError, RateLimitError, getErrorMessage } from './errors.js';
import { isRecord } from './utils.js';

export interface RateLimitRule {
  command: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitOptions {
  configPath?: string;
  statePath?: string;
  now?: number;
}

interface RateLimitState {
  version: 1;
  commands: Record<string, number[]>;
}

const CONFIG_FILE = 'rate-limits.yaml';
const STATE_FILE = 'rate-limit-state.json';

export function getRateLimitConfigPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.opencli', CONFIG_FILE);
}

export function getRateLimitStatePath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.opencli', STATE_FILE);
}

export function enforceRateLimit(command: string, opts: RateLimitOptions = {}): void {
  const configPath = opts.configPath ?? getRateLimitConfigPath();
  const rule = findRateLimitRule(command, configPath);
  if (!rule) return;

  const statePath = opts.statePath ?? getRateLimitStatePath();
  const now = opts.now ?? Date.now();
  const state = loadState(statePath);
  const existing = Array.isArray(state.commands[command]) ? state.commands[command] : [];
  const cutoff = now - rule.windowMs;
  const recent = existing.filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff);

  if (recent.length >= rule.limit) {
    const oldest = Math.min(...recent);
    const retryAfterMs = Math.max(0, oldest + rule.windowMs - now);
    state.commands[command] = recent;
    saveState(statePath, state);
    throw new RateLimitError(command, retryAfterMs, configPath);
  }

  state.commands[command] = [...recent, now];
  saveState(statePath, state);
}

export function findRateLimitRule(command: string, configPath: string = getRateLimitConfigPath()): RateLimitRule | null {
  const rules = loadRateLimitRules(configPath);
  return rules.find((rule) => rule.command === command) ?? null;
}

export function loadRateLimitRules(configPath: string = getRateLimitConfigPath()): RateLimitRule[] {
  if (!fs.existsSync(configPath)) return [];

  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf-8')) ?? {};
  } catch (err) {
    throw new ConfigError(
      `Failed to parse ${configPath}: ${getErrorMessage(err)}`,
      'Fix the YAML syntax or remove the file to disable command rate limits.',
    );
  }

  if (!isRecord(parsed)) {
    throw new ConfigError(`Invalid ${configPath}: root value must be an object with a rules array.`);
  }

  const rawRules = parsed.rules;
  if (rawRules === undefined) return [];
  if (!Array.isArray(rawRules)) {
    throw new ConfigError(`Invalid ${configPath}: rules must be an array.`);
  }

  return rawRules.map((rawRule, index) => parseRule(rawRule, index, configPath));
}

function parseRule(rawRule: unknown, index: number, configPath: string): RateLimitRule {
  const label = `${configPath} rules[${index}]`;
  if (!isRecord(rawRule)) {
    throw new ConfigError(`Invalid ${label}: rule must be an object.`);
  }

  const command = typeof rawRule.command === 'string' ? rawRule.command.trim() : '';
  if (!command) {
    throw new ConfigError(`Invalid ${label}: command must be a non-empty string.`);
  }

  const limit = Number(rawRule.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ConfigError(`Invalid ${label}: limit must be a positive integer.`);
  }

  if (typeof rawRule.window !== 'string' && typeof rawRule.window !== 'number') {
    throw new ConfigError(`Invalid ${label}: window must be a duration like 10m, 1h, or 500ms.`);
  }

  return {
    command,
    limit,
    windowMs: parseDurationMs(rawRule.window, `${label}.window`),
  };
}

function parseDurationMs(raw: string | number, label: string): number {
  const value = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
  if (!match) {
    throw new ConfigError(`Invalid ${label}: expected a duration like 10m, 1h, or 500ms.`);
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  const ms = Math.round(amount * multiplier);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new ConfigError(`Invalid ${label}: duration must be greater than zero.`);
  }
  return ms;
}

function loadState(statePath: string): RateLimitState {
  if (!fs.existsSync(statePath)) return emptyState();

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.commands)) return emptyState();

    const commands: Record<string, number[]> = {};
    for (const [command, timestamps] of Object.entries(parsed.commands)) {
      if (!Array.isArray(timestamps)) continue;
      commands[command] = timestamps.filter((timestamp): timestamp is number =>
        typeof timestamp === 'number' && Number.isFinite(timestamp),
      );
    }
    return { version: 1, commands };
  } catch {
    return emptyState();
  }
}

function saveState(statePath: string, state: RateLimitState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

function emptyState(): RateLimitState {
  return { version: 1, commands: {} };
}
