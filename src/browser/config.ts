import { log } from '../logger.js';

function parseEnvTimeout(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    log.warn(`[runtime] Invalid ${envVar}="${raw}", using default ${fallback}s`);
    return fallback;
  }
  return parsed;
}

export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_CONNECT_TIMEOUT', 45);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_COMMAND_TIMEOUT', 60);
