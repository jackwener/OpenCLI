import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('OPENCLI_CONFIG_DIR resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('honors OPENCLI_CONFIG_DIR across discovery and plugin manager helpers', async () => {
    const customDir = path.join('/tmp', 'opencli-custom-config-dir');
    vi.stubEnv('OPENCLI_CONFIG_DIR', customDir);
    vi.resetModules();

    const discovery = await import('./discovery.js');
    const plugin = await import('./plugin.js');

    expect(discovery.USER_OPENCLI_DIR).toBe(customDir);
    expect(discovery.USER_CLIS_DIR).toBe(path.join(customDir, 'clis'));
    expect(discovery.PLUGINS_DIR).toBe(path.join(customDir, 'plugins'));
    expect(plugin.getLockFilePath()).toBe(path.join(customDir, 'plugins.lock.json'));
    expect(plugin.getMonoreposDir()).toBe(path.join(customDir, 'monorepos'));
  });
});
