import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import { ConfigError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { getVisibleChatMessages } from './ax.js';

export const askCommand = cli({
  site: 'chatgpt',
  name: 'ask',
  description: 'Send a prompt and wait for the AI response (send + wait + read)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 30)', default: '30' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage | null, kwargs: any) => {
    if (process.platform !== 'darwin') {
      throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
    }

    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 30;

    // Backup clipboard
    let clipBackup = '';
    try { clipBackup = execSync('pbpaste', { encoding: 'utf-8' }); } catch {}
    const messagesBefore = getVisibleChatMessages();

    // Send the message
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

    // Restore clipboard after the prompt is sent.
    if (clipBackup) spawnSync('pbcopy', { input: clipBackup });

    // Wait for response, then read the latest visible assistant message from the AX tree.
    const pollInterval = 1;
    const maxPolls = Math.ceil(timeout / pollInterval);
    let response = '';

    for (let i = 0; i < maxPolls; i++) {
      execSync(`sleep ${pollInterval}`);
      execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
      execSync("osascript -e 'delay 0.2'");

      const messagesNow = getVisibleChatMessages();
      if (messagesNow.length <= messagesBefore.length) continue;

      const newMessages = messagesNow.slice(messagesBefore.length);
      const candidate = [...newMessages].reverse().find((message) => message !== text);
      if (candidate) {
        response = candidate;
        break;
      }
    }

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response within ${timeout}s. ChatGPT may still be generating.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});
