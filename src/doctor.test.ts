import { describe, expect, it } from 'vitest';
import {
  readTokenFromShellContent,
  renderBrowserDoctorReport,
  upsertShellToken,
  readTomlConfigToken,
  upsertTomlConfigToken,
  upsertJsonConfigToken,
} from './doctor.js';

describe('shell token helpers', () => {
  it('reads token from shell export', () => {
    expect(readTokenFromShellContent('export PLAYWRIGHT_MCP_EXTENSION_TOKEN="abc123"\n')).toBe('abc123');
  });

  it('appends token export when missing', () => {
    const next = upsertShellToken('export PATH="/usr/bin"\n', 'abc123');
    expect(next).toContain('export PLAYWRIGHT_MCP_EXTENSION_TOKEN="abc123"');
  });

  it('replaces token export when present', () => {
    const next = upsertShellToken('export PLAYWRIGHT_MCP_EXTENSION_TOKEN="old"\n', 'new');
    expect(next).toContain('export PLAYWRIGHT_MCP_EXTENSION_TOKEN="new"');
    expect(next).not.toContain('"old"');
  });
});

describe('toml token helpers', () => {
  it('reads token from playwright env section', () => {
    const content = `
[mcp_servers.playwright.env]
PLAYWRIGHT_MCP_EXTENSION_TOKEN = "abc123"
`;
    expect(readTomlConfigToken(content)).toBe('abc123');
  });

  it('updates token inside existing env section', () => {
    const content = `
[mcp_servers.playwright.env]
PLAYWRIGHT_MCP_EXTENSION_TOKEN = "old"
`;
    const next = upsertTomlConfigToken(content, 'new');
    expect(next).toContain('PLAYWRIGHT_MCP_EXTENSION_TOKEN = "new"');
    expect(next).not.toContain('"old"');
  });

  it('creates env section when missing', () => {
    const content = `
[mcp_servers.playwright]
type = "stdio"
`;
    const next = upsertTomlConfigToken(content, 'abc123');
    expect(next).toContain('[mcp_servers.playwright.env]');
    expect(next).toContain('PLAYWRIGHT_MCP_EXTENSION_TOKEN = "abc123"');
  });
});

describe('json token helpers', () => {
  it('writes token into standard mcpServers config', () => {
    const next = upsertJsonConfigToken(JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest', '--extension'],
        },
      },
    }), 'abc123');
    const parsed = JSON.parse(next);
    expect(parsed.mcpServers.playwright.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe('abc123');
  });

  it('writes token into opencode mcp config', () => {
    const next = upsertJsonConfigToken(JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        playwright: {
          command: ['npx', '-y', '@playwright/mcp@latest', '--extension'],
          enabled: true,
          type: 'local',
        },
      },
    }), 'abc123');
    const parsed = JSON.parse(next);
    expect(parsed.mcp.playwright.environment.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe('abc123');
  });
});

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('renders OK-style report when tokens match', () => {
    const text = strip(renderBrowserDoctorReport({
      envToken: 'abc123',
      envFingerprint: 'fp1',
      extensionToken: 'abc123',
      extensionFingerprint: 'fp1',
      shellFiles: [{ path: '/tmp/.zshrc', exists: true, token: 'abc123', fingerprint: 'fp1' }],
      configs: [{ path: '/tmp/mcp.json', exists: true, format: 'json', token: 'abc123', fingerprint: 'fp1', writable: true }],
      recommendedToken: 'abc123',
      recommendedFingerprint: 'fp1',
      warnings: [],
      issues: [],
    }));

    expect(text).toContain('[OK] Environment token: configured (fp1)');
    expect(text).toContain('[OK] /tmp/mcp.json');
    expect(text).toContain('configured (fp1)');
  });

  it('renders MISMATCH-style report when fingerprints differ', () => {
    const text = strip(renderBrowserDoctorReport({
      envToken: 'abc123',
      envFingerprint: 'fp1',
      extensionToken: null,
      extensionFingerprint: null,
      shellFiles: [{ path: '/tmp/.zshrc', exists: true, token: 'def456', fingerprint: 'fp2' }],
      configs: [{ path: '/tmp/mcp.json', exists: true, format: 'json', token: 'abc123', fingerprint: 'fp1', writable: true }],
      recommendedToken: 'abc123',
      recommendedFingerprint: 'fp1',
      warnings: [],
      issues: ['Detected inconsistent Playwright MCP tokens across env/config files.'],
    }));

    expect(text).toContain('[MISMATCH] Environment token: configured (fp1)');
    expect(text).toContain('[MISMATCH] /tmp/.zshrc');
    expect(text).toContain('configured (fp2)');
    expect(text).toContain('[MISMATCH] Recommended token fingerprint: fp1');
  });
});

