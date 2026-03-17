/**
 * MCP server path discovery and argument building.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let _cachedMcpServerPath: string | null | undefined;

export function findMcpServerPath(): string | null {
  if (_cachedMcpServerPath !== undefined) return _cachedMcpServerPath;

  const envMcp = process.env.OPENCLI_MCP_SERVER_PATH;
  if (envMcp && fs.existsSync(envMcp)) {
    _cachedMcpServerPath = envMcp;
    return _cachedMcpServerPath;
  }

  // Check local node_modules first (@playwright/mcp is the modern package)
  const localMcp = path.resolve('node_modules', '@playwright', 'mcp', 'cli.js');
  if (fs.existsSync(localMcp)) {
    _cachedMcpServerPath = localMcp;
    return _cachedMcpServerPath;
  }

  // Check project-relative path
  const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
  const projectMcp = path.resolve(__dirname2, '..', '..', 'node_modules', '@playwright', 'mcp', 'cli.js');
  if (fs.existsSync(projectMcp)) {
    _cachedMcpServerPath = projectMcp;
    return _cachedMcpServerPath;
  }

  // Check common locations
  const candidates = [
    path.join(os.homedir(), '.npm', '_npx'),
    path.join(os.homedir(), 'node_modules', '.bin'),
    '/usr/local/lib/node_modules',
  ];

  // Try npx resolution (legacy package name)
  try {
    const result = execSync('npx -y --package=@playwright/mcp which mcp-server-playwright 2>/dev/null', { encoding: 'utf-8', timeout: 10000 }).trim();
    if (result && fs.existsSync(result)) {
      _cachedMcpServerPath = result;
      return _cachedMcpServerPath;
    }
  } catch {}

  // Try which
  try {
    const result = execSync('which mcp-server-playwright 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) {
      _cachedMcpServerPath = result;
      return _cachedMcpServerPath;
    }
  } catch {}

  // Search in common npx cache
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    try {
      const found = execSync(`find "${base}" -name "cli.js" -path "*playwright*mcp*" 2>/dev/null | head -1`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (found) {
        _cachedMcpServerPath = found;
        return _cachedMcpServerPath;
      }
    } catch {}
  }

  _cachedMcpServerPath = null;
  return _cachedMcpServerPath;
}

type BrowserMode = 'extension' | 'standalone';

function getBrowserMode(): BrowserMode {
  const override = process.env.OPENCLI_BROWSER_MODE?.trim().toLowerCase();
  if (override === 'extension' || override === 'standalone') return override;
  return process.env.CI ? 'standalone' : 'extension';
}

function shouldDisableSandbox(): boolean {
  if (process.env.OPENCLI_MCP_NO_SANDBOX === '1') return true;
  return process.platform === 'linux' && process.getuid?.() === 0;
}

export function buildMcpArgs(input: { mcpPath: string; executablePath?: string | null }): string[] {
  const args = [input.mcpPath];
  if (getBrowserMode() === 'extension') {
    // Extension mode connects to the user's running Chrome via MCP Bridge.
    args.push('--extension');
  }
  // Standalone mode launches its own browser. CI uses this by default.
  if (input.executablePath) {
    args.push('--executable-path', input.executablePath);
  }
  if (shouldDisableSandbox()) {
    args.push('--no-sandbox');
  }
  return args;
}
