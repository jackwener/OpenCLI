import { execSync, spawnSync } from 'node:child_process';
import { CliError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  chatGPTAsyncSendHint,
  chatGPTCDPHint,
  formatChatGPTSendResultRow,
  hasChatGPTCDPConfigured,
  sendChatGPTCDP,
} from './cdp.js';

export const sendCommand = cli({
  site: 'chatgpt',
  name: 'send',
  description: 'Submit a message to ChatGPT Desktop and return immediately (use read later; experimental CDP when configured; AppleScript fallback on macOS)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message to submit (command returns immediately; use read later)' },
    {
      name: 'reasoning',
      required: false,
      help: 'Experimental CDP only: switch the top-level reasoning mode before submitting (instant, thinking, pro; auto → instant)',
    },
  ],
  columns: ['Status', 'Mode', 'Reasoning', 'Submit', 'InjectedText'],
  footerExtra: () => chatGPTAsyncSendHint(),
  func: async (_page: IPage | null, kwargs: any) => {
    const text = kwargs.text as string;
    const reasoning = kwargs.reasoning as string | undefined;

    if (hasChatGPTCDPConfigured()) {
      return await sendChatGPTCDP(text, { reasoning });
    }

    if (reasoning) {
      throw new CliError(
        'CONFIG',
        'ChatGPT reasoning switching currently requires experimental CDP mode.',
        chatGPTCDPHint(),
      );
    }

    if (process.platform !== 'darwin') {
      throw new CliError(
        'CONFIG',
        'ChatGPT send requires macOS AppleScript fallback or experimental CDP mode.',
        chatGPTCDPHint(),
      );
    }

    try {
      let clipBackup = '';
      try {
        clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
      } catch {
        // clipboard may be empty
      }

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

      if (clipBackup) {
        spawnSync('pbcopy', { input: clipBackup });
      }

      return [formatChatGPTSendResultRow({ mode: 'AppleScript', submitMethod: 'clipboard-paste', injectedText: text })];
    } catch (err: any) {
      return [{ Status: 'Error: ' + err.message, Mode: 'AppleScript', Reasoning: '', Submit: '', InjectedText: text }];
    }
  },
});
