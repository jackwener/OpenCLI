import * as fs from 'node:fs';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const screenshotCommand = cli({
  site: 'chatwise',
  name: 'screenshot',
  description: 'Capture a snapshot of the current ChatWise window (DOM + Accessibility tree)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'output', required: false,  help: 'Output file path (default: /tmp/chatwise-snapshot)' },
  ],
  columns: ['Status', 'File'],
  func: async (page: IPage, kwargs: any) => {
    const basePath = (kwargs.output as string) || '/tmp/chatwise-snapshot';

    const snap = await page.snapshot({ compact: true });
    const html = await page.evaluate('document.documentElement.outerHTML');

    const htmlPath = basePath + '-dom.html';
    const snapPath = basePath + '-a11y.txt';

    fs.writeFileSync(htmlPath, html);
    fs.writeFileSync(snapPath, typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2));

    return [
      { Status: 'Success', File: htmlPath },
      { Status: 'Success', File: snapPath },
    ];
  },
});
