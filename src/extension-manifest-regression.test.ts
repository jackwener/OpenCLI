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
});
