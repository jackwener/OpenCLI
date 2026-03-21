import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { probeChatGPTCDP } from './cdp.js';
import {
  isChatGPTCDPSurface,
  normalizeChatGPTSurface,
  requireMacOSHost,
} from './surface.js';

export const statusCommand = cli({
  site: 'chatgpt',
  name: 'status',
  description: 'Check ChatGPT Desktop App status',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{
    name: 'surface',
    required: false,
    default: 'macos-native',
    choices: ['macos-native', 'macos-cdp', 'windows-cdp'],
    help: 'Target ChatGPT surface: macos-native (default), macos-cdp, windows-cdp',
  }],
  columns: ['Status'],
  func: async (_page: IPage | null, kwargs: any) => {
    const surface = normalizeChatGPTSurface(kwargs.surface);

    if (isChatGPTCDPSurface(surface)) {
      return [await probeChatGPTCDP(surface)];
    }

    requireMacOSHost('status');

    try {
      const output = execSync("osascript -e 'application \"ChatGPT\" is running'", { encoding: 'utf-8' }).trim();
      return [{ Status: output === 'true' ? 'Running' : 'Stopped' }];
    } catch {
      return [{ Status: 'Error querying application state' }];
    }
  },
});
