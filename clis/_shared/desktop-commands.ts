/**
 * Shared command factories for Electron/desktop app adapters.
 * Eliminates duplicate screenshot/status/new/dump implementations
 * across cursor, codex, chatwise, etc.
 */

import * as fs from 'node:fs';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import type { CliOptions } from '../../src/registry.js';

/**
 * Factory: capture DOM HTML + accessibility snapshot.
 */
export function makeScreenshotCommand(site: string, displayName?: string, extra: Partial<CliOptions> = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'screenshot',
    description: `Capture a snapshot of the current ${label} window (DOM + Accessibility tree)`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
      { name: 'output', required: false, help: `Output file path (default: /tmp/${site}-snapshot.txt)` },
    ],
    columns: ['Status', 'File'],
    func: async (page: IPage, kwargs: any) => {
      const outputPath = (kwargs.output as string) || `/tmp/${site}-snapshot.txt`;

      const snap = await page.snapshot({ compact: true });
      const html = await page.evaluate('document.documentElement.outerHTML');

      const htmlPath = outputPath.replace(/\.\w+$/, '') + '-dom.html';
      const snapPath = outputPath.replace(/\.\w+$/, '') + '-a11y.txt';

      fs.writeFileSync(htmlPath, html);
      fs.writeFileSync(snapPath, typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2));

      return [
        { Status: 'Success', File: htmlPath },
        { Status: 'Success', File: snapPath },
      ];
    },
  });
}

/**
 * Factory: check CDP connection status.
 */
export function makeStatusCommand(site: string, displayName?: string, extra: Partial<CliOptions> = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'status',
    description: `Check active CDP connection to ${label}`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['Status', 'Url', 'Title'],
    func: async (page: IPage) => {
      const url = await page.evaluate('window.location.href');
      const title = await page.evaluate('document.title');
      return [{ Status: 'Connected', Url: url, Title: title }];
    },
  });
}

/**
 * Factory: start a new session via Cmd/Ctrl+N.
 */
export function makeNewCommand(site: string, displayName?: string, extra: Partial<CliOptions> = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'new',
    description: `Start a new ${label} session`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['Status'],
    func: async (page: IPage) => {
      const isMac = process.platform === 'darwin';
      await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
      await page.wait(1);
      return [{ Status: 'Success' }];
    },
  });
}

/**
 * Factory: dump DOM + snapshot for reverse-engineering.
 */
export function makeDumpCommand(site: string) {
  return cli({
    site,
    name: 'dump',
    description: `Dump the DOM and Accessibility tree of ${site} for reverse-engineering`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['action', 'files'],
    func: async (page: IPage) => {
      const dom = await page.evaluate('document.body.innerHTML');
      fs.writeFileSync(`/tmp/${site}-dom.html`, dom);

      const snap = await page.snapshot({ interactive: false });
      fs.writeFileSync(`/tmp/${site}-snapshot.json`, JSON.stringify(snap, null, 2));

      return [
        {
          action: 'Dom extraction finished',
          files: `/tmp/${site}-dom.html, /tmp/${site}-snapshot.json`,
        },
      ];
    },
  });
}
