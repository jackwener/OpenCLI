import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { getVisibleChatMessages } from './ax.js';

export const readCommand = cli({
  site: 'chatgpt',
  name: 'read',
  description: 'Read the last visible message from the focused ChatGPT Desktop window',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Role', 'Text'],
  func: async (page: IPage | null) => {
    try {
      execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
      execSync("osascript -e 'delay 0.3'");
      const messages = getVisibleChatMessages();

      if (!messages.length) {
        return [{ Role: 'System', Text: 'No visible chat messages were found in the current ChatGPT window.' }];
      }

      return [{ Role: 'Assistant', Text: messages[messages.length - 1] }];
    } catch (err: any) {
      throw new Error("Failed to read from ChatGPT: " + err.message);
    }
  },
});
