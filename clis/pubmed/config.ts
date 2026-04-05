/**
 * PubMed Configuration Adapter
 *
 * Manage NCBI API key for higher rate limits.
 * Without API key: 3 requests/second
 * With API key: 10 requests/second
 *
 * Get your API key from: https://www.ncbi.nlm.nih.gov/account/settings/
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Configuration file path
const CONFIG_DIR = join(homedir(), '.opencli');
const CONFIG_FILE = join(CONFIG_DIR, 'pubmed-config.json');

export interface PubMedConfig {
  apiKey?: string;
  email?: string;
  rateLimitMs?: number;
}

/**
 * Load PubMed configuration from file
 */
export function loadConfig(): PubMedConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data) as PubMedConfig;
  } catch {
    return {};
  }
}

/**
 * Save PubMed configuration to file
 */
export function saveConfig(config: PubMedConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get API key from config
 */
export function getApiKey(): string | undefined {
  // First check environment variable
  const envKey = process.env.NCBI_API_KEY;
  if (envKey) return envKey;

  // Then check config file
  const config = loadConfig();
  return config.apiKey;
}

/**
 * Get email from config (recommended by NCBI for identification)
 */
export function getEmail(): string | undefined {
  // First check environment variable
  const envEmail = process.env.NCBI_EMAIL;
  if (envEmail) return envEmail;

  // Then check config file
  const config = loadConfig();
  return config.email;
}

/**
 * Get rate limit delay in milliseconds
 * With API key: 100ms (10 req/s)
 * Without API key: 350ms (3 req/s)
 */
export function getRateLimitMs(): number {
  const config = loadConfig();
  if (config.rateLimitMs) return config.rateLimitMs;

  // Default based on API key presence
  return getApiKey() ? 100 : 350;
}

// ── Commands ──────────────────────────────────────────────────────────────────

cli({
  site: 'pubmed',
  name: 'config',
  description: 'Configure PubMed API settings (API key, email, rate limits)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'action',
      type: 'string',
      required: false,
      positional: true,
      help: 'Action: set, get, remove, or reset',
    },
    {
      name: 'key',
      type: 'string',
      required: false,
      help: 'Configuration key: api-key, email, or rate-limit',
    },
    {
      name: 'value',
      type: 'string',
      required: false,
      help: 'Value to set (for set action)',
    },
  ],
  columns: ['setting', 'value'],
  func: async (_page, args) => {
    const action = (args.action || 'get').toLowerCase();
    const config = loadConfig();

    switch (action) {
      case 'get':
      case 'show': {
        // Show current configuration
        const apiKey = config.apiKey;
        const email = config.email;
        const rateLimitMs = config.rateLimitMs;

        return [
          {
            setting: 'api-key',
            value: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : '(not set)',
          },
          {
            setting: 'email',
            value: email || '(not set)',
          },
          {
            setting: 'rate-limit-ms',
            value: rateLimitMs?.toString() || `(auto: ${getApiKey() ? '100' : '350'}ms)`,
          },
          {
            setting: 'effective-rate-limit',
            value: `${getRateLimitMs()}ms (${getApiKey() ? '10' : '3'} req/s)`,
          },
          {
            setting: 'config-file',
            value: CONFIG_FILE,
          },
        ];
      }

      case 'set': {
        const key = args.key;
        const value = args.value;

        if (!key) {
          throw new CliError(
            'MISSING_ARGUMENT',
            'Configuration key is required for set action',
            'Usage: opencli pubmed config set <key> <value>\nKeys: api-key, email, rate-limit'
          );
        }

        switch (key.toLowerCase()) {
          case 'api-key':
          case 'apikey':
          case 'api_key': {
            if (!value) {
              throw new CliError(
                'MISSING_ARGUMENT',
                'API key value is required',
                'Get your API key from: https://www.ncbi.nlm.nih.gov/account/settings/'
              );
            }
            config.apiKey = value;
            saveConfig(config);
            return [{
              setting: 'api-key',
              value: `${value.slice(0, 8)}...${value.slice(-4)} (saved)`,
            }];
          }

          case 'email': {
            if (!value) {
              throw new CliError(
                'MISSING_ARGUMENT',
                'Email value is required',
                'Providing email helps NCBI contact you if there are issues'
              );
            }
            config.email = value;
            saveConfig(config);
            return [{
              setting: 'email',
              value: `${value} (saved)`,
            }];
          }

          case 'rate-limit':
          case 'ratelimit':
          case 'rate_limit': {
            if (!value) {
              throw new CliError(
                'MISSING_ARGUMENT',
                'Rate limit value is required',
                'Value in milliseconds (e.g., 100 for 10 req/s, 350 for 3 req/s)'
              );
            }
            const ms = parseInt(value, 10);
            if (isNaN(ms) || ms < 0) {
              throw new CliError(
                'INVALID_ARGUMENT',
                'Invalid rate limit value',
                'Must be a positive number in milliseconds'
              );
            }
            config.rateLimitMs = ms;
            saveConfig(config);
            return [{
              setting: 'rate-limit-ms',
              value: `${ms}ms (${Math.round(1000 / ms)} req/s)`,
            }];
          }

          default:
            throw new CliError(
              'INVALID_ARGUMENT',
              `Unknown configuration key: ${key}`,
              'Valid keys: api-key, email, rate-limit'
            );
        }
      }

      case 'remove':
      case 'delete':
      case 'unset': {
        const key = args.key;

        if (!key) {
          throw new CliError(
            'MISSING_ARGUMENT',
            'Configuration key is required for remove action',
            'Usage: opencli pubmed config remove <key>\nKeys: api-key, email, rate-limit'
          );
        }

        switch (key.toLowerCase()) {
          case 'api-key':
          case 'apikey':
          case 'api_key': {
            delete config.apiKey;
            saveConfig(config);
            return [{ setting: 'api-key', value: '(removed)' }];
          }

          case 'email': {
            delete config.email;
            saveConfig(config);
            return [{ setting: 'email', value: '(removed)' }];
          }

          case 'rate-limit':
          case 'ratelimit':
          case 'rate_limit': {
            delete config.rateLimitMs;
            saveConfig(config);
            return [{ setting: 'rate-limit-ms', value: '(auto)' }];
          }

          default:
            throw new CliError(
              'INVALID_ARGUMENT',
              `Unknown configuration key: ${key}`,
              'Valid keys: api-key, email, rate-limit'
            );
        }
      }

      case 'reset': {
        saveConfig({});
        return [
          { setting: 'api-key', value: '(reset)' },
          { setting: 'email', value: '(reset)' },
          { setting: 'rate-limit-ms', value: '(auto)' },
        ];
      }

      default:
        throw new CliError(
          'INVALID_ARGUMENT',
          `Unknown action: ${action}`,
          'Valid actions: get, set, remove, reset'
        );
    }
  },
});
