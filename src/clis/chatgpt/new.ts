import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { requireMacOSHost } from './surface.js';

export const newCommand = cli({
  site: 'chatgpt',
  name: 'new',
  description: 'Open a new chat in ChatGPT Desktop App',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Status'],
  func: async (_page: IPage | null) => {
    requireMacOSHost('new');

    try {
      execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
      execSync("osascript -e 'delay 0.5'");
      execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
      return [{ Status: 'Success' }];
    } catch (err: any) {
      return [{ Status: 'Error: ' + err.message }];
    }
  },
});
