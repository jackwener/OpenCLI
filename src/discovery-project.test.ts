/**
 * Tests for project-local discovery: ./.opencli/clis and ./.opencli/plugins.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  discoverClis,
  discoverPlugins,
  projectClisDir,
  projectOpenCliDir,
  projectPluginsDir,
} from './discovery.js';
import { getRegistry } from './registry.js';

describe('project-local discovery paths', () => {
  it('projectOpenCliDir / projectClisDir / projectPluginsDir resolve relative to the given cwd', () => {
    const cwd = '/tmp/example-project';
    expect(projectOpenCliDir(cwd)).toBe(path.join(cwd, '.opencli'));
    expect(projectClisDir(cwd)).toBe(path.join(cwd, '.opencli', 'clis'));
    expect(projectPluginsDir(cwd)).toBe(path.join(cwd, '.opencli', 'plugins'));
  });

  it('discoverClis(projectDir) loads adapters from a project-local clis directory', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-project-clis-'));
    const site = 'project-local-site';
    const registryUrl = pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href;

    try {
      const siteDir = path.join(tempRoot, site);
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'hello.js'), `
import { cli, Strategy } from '${registryUrl}';
cli({
  site: '${site}',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      await discoverClis(tempRoot);
      expect(getRegistry().get(`${site}/hello`)).toBeDefined();
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('discoverPlugins(dir) loads plugin files from a project-local plugins directory', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-project-plugins-'));
    const pluginName = 'project-plugin-site';
    const pluginDir = path.join(tempRoot, pluginName);
    const registryUrl = pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href;

    try {
      await fs.promises.mkdir(pluginDir, { recursive: true });
      await fs.promises.writeFile(path.join(pluginDir, 'hi.js'), `
import { cli, Strategy } from '${registryUrl}';
cli({
  site: '${pluginName}',
  name: 'hi', access: 'read',
  description: 'hi command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      await discoverPlugins(tempRoot);
      expect(getRegistry().get(`${pluginName}/hi`)).toBeDefined();
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
