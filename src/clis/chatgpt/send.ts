import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { sendChatGPTCDP } from './cdp.js';
import {
  isChatGPTCDPSurface,
  normalizeChatGPTSurface,
  requireMacOSHost,
} from './surface.js';

export const sendCommand = cli({
  site: 'chatgpt',
  name: 'send',
  description: 'Send a message to the active ChatGPT Desktop App window',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message to send' },
    {
      name: 'surface',
      required: false,
      default: 'macos-native',
      choices: ['macos-native', 'macos-cdp', 'windows-cdp'],
      help: 'Target ChatGPT surface: macos-native (default), macos-cdp, windows-cdp',
    },
  ],
  columns: ['Status'],
  func: async (_page: IPage | null, kwargs: any) => {
    const text = kwargs.text as string;
    const surface = normalizeChatGPTSurface(kwargs.surface);

    if (isChatGPTCDPSurface(surface)) {
      return await sendChatGPTCDP(text, surface);
    }

    requireMacOSHost('send');

    try {
      // Backup current clipboard content
      let clipBackup = '';
      try {
        clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
      } catch {
        // clipboard may be empty
      }

      // Copy text to clipboard
      spawnSync('pbcopy', { input: text });

      execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
      execSync("osascript -e 'delay 0.5'");

      const cmd = "osascript " +
                  "-e 'tell application \"System Events\"' " +
                  "-e 'keystroke \"v\" using command down' " +
                  "-e 'delay 0.2' " +
                  "-e 'keystroke return' " +
                  "-e 'end tell'";

      execSync(cmd);

      // Restore original clipboard content
      if (clipBackup) {
        spawnSync('pbcopy', { input: clipBackup });
      }

      return [{ Status: 'Success' }];
    } catch (err: any) {
      return [{ Status: 'Error: ' + err.message }];
    }
  },
});
