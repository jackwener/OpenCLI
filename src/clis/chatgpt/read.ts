import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { getVisibleChatMessages } from './ax.js';
import { readChatGPTCDP } from './cdp.js';
import {
  isChatGPTCDPSurface,
  normalizeChatGPTSurface,
  requireMacOSHost,
} from './surface.js';

export const readCommand = cli({
  site: 'chatgpt',
  name: 'read',
  description: 'Read the last visible message from the focused ChatGPT Desktop window',
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
  columns: ['Role', 'Text'],
  func: async (_page: IPage | null, kwargs: any) => {
    const surface = normalizeChatGPTSurface(kwargs.surface);

    if (isChatGPTCDPSurface(surface)) {
      return await readChatGPTCDP(surface);
    }

    requireMacOSHost('read');

    try {
      execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
      execSync("osascript -e 'delay 0.3'");
      const messages = getVisibleChatMessages();

      if (!messages.length) {
        return [{ Role: 'System', Text: 'No visible chat messages were found in the current ChatGPT window.' }];
      }

      return [{ Role: 'Assistant', Text: messages[messages.length - 1] }];
    } catch (err: any) {
      throw new Error('Failed to read from ChatGPT: ' + err.message);
    }
  },
});
