import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest regression', () => {
  it('keeps host permissions required by chrome.cookies.getAll', async () => {
    const manifestPath = path.resolve(process.cwd(), 'extension', 'manifest.json');
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as {
      permissions?: string[];
      host_permissions?: string[];
    };

    expect(manifest.permissions).toContain('cookies');
    expect(manifest.host_permissions).toContain('<all_urls>');
  });

  it('ships the fixed uploader under a new consistent extension version', async () => {
    const extensionRoot = path.resolve(process.cwd(), 'extension');
    const [manifestRaw, packageRaw, lockRaw] = await Promise.all([
      fs.readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'),
      fs.readFile(path.join(extensionRoot, 'package.json'), 'utf8'),
      fs.readFile(path.join(extensionRoot, 'package-lock.json'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestRaw) as { version?: string };
    const packageJson = JSON.parse(packageRaw) as { version?: string };
    const lock = JSON.parse(lockRaw) as { packages?: { '': { version?: string } } };

    expect(manifest.version).toBe('1.0.23');
    expect(packageJson.version).toBe(manifest.version);
    expect(lock.packages?.[''].version).toBe(manifest.version);
  });
});
