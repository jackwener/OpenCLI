import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';

export const dumpCommand = cli({
  site: 'doubao-app',
  name: 'dump',
  description: 'Dump Doubao desktop app DOM and snapshot to /tmp for debugging',
  domain: 'doubao-app',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Status', 'File'],
  func: async (page) => {
    const htmlPath = '/tmp/doubao-dom.html';
    const snapPath = '/tmp/doubao-snapshot.json';

    const html = await page.evaluate('document.documentElement.outerHTML');
    const snap = await page.snapshot({ compact: true });

    fs.writeFileSync(htmlPath, html);
    fs.writeFileSync(snapPath, typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2));

    return [
      { Status: 'Success', File: htmlPath },
      { Status: 'Success', File: snapPath },
    ];
  },
});