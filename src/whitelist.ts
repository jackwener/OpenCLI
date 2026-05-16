import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import yaml from 'js-yaml';
import { log } from './logger.js';
import { getErrorMessage } from './errors.js';

export function getWhitelistPath(): string {
  const home = os.homedir();
  return path.join(home, '.opencli', 'whitelist.yaml');
}

export interface ProcessedWhitelist {
  sites: Record<string, Set<string> | null>;
}

let _cachedWhitelist: ProcessedWhitelist | null = null;

/**
 * Supported YAML format (array only):
 *
 *   sites:
 *     - bilibili
 *     - reddit: hot, popular
 *     - twitter: timeline, trending, search
 *
 * Strings → entire site enabled (null).
 * Objects → comma-separated commands parsed into a Set.
 */
export function loadWhitelist(): ProcessedWhitelist | null {
  if (_cachedWhitelist) return _cachedWhitelist;

  const whitelistPath = getWhitelistPath();
  if (!fs.existsSync(whitelistPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(whitelistPath, 'utf8');
    const parsed: any = yaml.load(raw);
    if (!parsed || !Array.isArray(parsed.sites)) {
      return null;
    }

    const processed: ProcessedWhitelist = { sites: {} };

    for (const item of parsed.sites) {
      if (typeof item === 'string') {
        processed.sites[item] = null;
      } else if (item && typeof item === 'object') {
        for (const [site, value] of Object.entries(item)) {
          if (value === null || value === undefined) {
            processed.sites[site] = null;
          } else if (typeof value === 'string') {
            processed.sites[site] = new Set(
              value.split(',').map(cmd => cmd.trim().toLowerCase()).filter(Boolean)
            );
          }
        }
      }
    }

    _cachedWhitelist = processed;
    return _cachedWhitelist;
  } catch (err) {
    log.warn(`Failed to parse whitelist.yaml: ${getErrorMessage(err)}`);
    return null;
  }
}

/**
 * Check if a command is whitelisted for a given site.
 * O(1) lookup using Set.has()
 */
export function isCommandWhitelisted(site: string, name: string, whitelist: ProcessedWhitelist): boolean {
  const siteConfig = whitelist.sites?.[site];

  // If site not in config → not whitelisted
  if (siteConfig === undefined) {
    return false;
  }

  // If site value is null → entire site enabled
  if (siteConfig === null) {
    return true;
  }

  // If site value is Set → check if command in set (O(1))
  return siteConfig.has(name.toLowerCase());
}