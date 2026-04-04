import { cli, Strategy } from '../../registry.js';

export const screenshotCommand = cli({
  site: 'doubao-app',
  name: 'screenshot',
  description: 'Capture a screenshot of the Doubao desktop app window',
  domain: 'doubao-app',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'output', required: false, help: 'Output file path (default: /tmp/doubao-screenshot.png)' },
  ],
  columns: ['Status', 'File'],
  func: async (page, kwargs) => {
    const outputPath = (kwargs.output as string) || '/tmp/doubao-screenshot.png';
    await page.screenshot({ path: outputPath });
    return [{ Status: 'Success', File: outputPath }];
  },
});