import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const DEFAULT_CONTEXT_ID = 'default';

export type ProfileConfig = {
  version: 1;
  defaultContextId?: string;
  aliases: Record<string, string>;
};

function profileConfigPath(): string {
  const baseDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
  return path.join(baseDir, 'browser-profiles.json');
}

export function normalizeContextId(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function emptyProfileConfig(): ProfileConfig {
  return { version: 1, aliases: {} };
}

export function loadProfileConfig(): ProfileConfig {
  try {
    const raw = fs.readFileSync(profileConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProfileConfig>;
    const aliases = parsed.aliases && typeof parsed.aliases === 'object'
      ? Object.fromEntries(Object.entries(parsed.aliases).filter((entry): entry is [string, string] => {
        const [key, value] = entry;
        return typeof key === 'string' && key.trim().length > 0
          && typeof value === 'string' && value.trim().length > 0;
      }))
      : {};
    return {
      version: 1,
      aliases,
      ...(typeof parsed.defaultContextId === 'string' && parsed.defaultContextId.trim()
        ? { defaultContextId: parsed.defaultContextId.trim() }
        : {}),
    };
  } catch {
    return emptyProfileConfig();
  }
}

export function saveProfileConfig(config: ProfileConfig): void {
  const target = profileConfigPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resolveProfileContextId(profile?: string): string | undefined {
  const config = loadProfileConfig();
  const requested = normalizeContextId(profile)
    ?? normalizeContextId(process.env.OPENCLI_PROFILE)
    ?? normalizeContextId(config.defaultContextId);
  if (!requested) return undefined;
  return config.aliases[requested] ?? requested;
}

export function aliasForContextId(config: ProfileConfig, contextId: string): string | undefined {
  for (const [alias, id] of Object.entries(config.aliases)) {
    if (id === contextId) return alias;
  }
  return undefined;
}

export function renameProfile(contextId: string, alias: string): ProfileConfig {
  const normalizedContextId = normalizeContextId(contextId);
  const normalizedAlias = normalizeContextId(alias);
  if (!normalizedContextId) throw new Error('profile contextId is required');
  if (!normalizedAlias) throw new Error('profile alias is required');

  const config = loadProfileConfig();
  for (const [existingAlias, existingContextId] of Object.entries(config.aliases)) {
    if (existingAlias !== normalizedAlias && existingContextId === normalizedContextId) {
      delete config.aliases[existingAlias];
    }
  }
  config.aliases[normalizedAlias] = normalizedContextId;
  saveProfileConfig(config);
  return config;
}

export function setDefaultProfile(profile: string): ProfileConfig {
  const contextId = resolveProfileContextId(profile) ?? normalizeContextId(profile);
  if (!contextId) throw new Error('profile is required');
  const config = loadProfileConfig();
  config.defaultContextId = contextId;
  saveProfileConfig(config);
  return config;
}
