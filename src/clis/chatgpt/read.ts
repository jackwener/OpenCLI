import { execSync } from 'node:child_process';
import { CliError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { getVisibleChatMessages } from './ax.js';
import { chatGPTCDPHint, hasChatGPTCDPConfigured, readChatGPTCDP } from './cdp.js';

export const readCommand = cli({
  site: 'chatgpt',
  name: 'read',
  description: 'Read the current ChatGPT conversation (use after async send to fetch output; experimental CDP when configured; AppleScript fallback on macOS)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Role', 'Text'],
  func: async (_page: IPage | null) => {
    if (hasChatGPTCDPConfigured()) {
      return await readChatGPTCDP();
    }

    if (process.platform !== 'darwin') {
      throw new CliError(
        'CONFIG',
        'ChatGPT read requires macOS AppleScript fallback or experimental CDP mode.',
        chatGPTCDPHint(),
      );
    }

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
