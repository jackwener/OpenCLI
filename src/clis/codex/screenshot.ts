import * as fs from 'node:fs';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const screenshotCommand = cli({
  site: 'codex',
  name: 'screenshot',
  description: 'Capture a snapshot of the current Codex window (DOM + Accessibility tree)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'output', required: false,  help: 'Output file path (default: /tmp/codex-snapshot.txt)' },
  ],
  columns: ['Status', 'File'],
  func: async (page: IPage, kwargs: any) => {
    const outputPath = (kwargs.output as string) || '/tmp/codex-snapshot.txt';

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
