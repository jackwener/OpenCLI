import { execSync } from 'node:child_process';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { formatChatGPTStatusRow, hasChatGPTCDPConfigured, probeChatGPTCDP } from './cdp.js';

export const statusCommand = cli({
  site: 'chatgpt',
  name: 'status',
  description: 'Check ChatGPT Desktop status (Busy shows whether ChatGPT is still generating; AppleScript fallback; experimental CDP when OPENCLI_CDP_ENDPOINT is set)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Status', 'Mode', 'Url', 'Title', 'Turns', 'Composer', 'Reasoning', 'Busy'],
  func: async (_page: IPage | null) => {
    if (hasChatGPTCDPConfigured()) {
      return [formatChatGPTStatusRow(await probeChatGPTCDP())];
    }

    if (process.platform !== 'darwin') {
      return [{
        Status: 'CDP required',
        Mode: 'Unavailable',
        Url: '',
        Title: 'Set OPENCLI_CDP_ENDPOINT for experimental ChatGPT desktop control on this platform.',
        Turns: '',
        Composer: '',
        Reasoning: '',
        Busy: '',
      }];
    }

    try {
      const output = execSync("osascript -e 'application \"ChatGPT\" is running'", { encoding: 'utf-8' }).trim();
      return [{
        Status: output === 'true' ? 'Running' : 'Stopped',
        Mode: 'AppleScript',
        Url: '',
        Title: '',
        Turns: '',
        Composer: '',
        Reasoning: '',
        Busy: '',
      }];
    } catch {
      return [{
        Status: 'Error querying application state',
        Mode: 'AppleScript',
        Url: '',
        Title: '',
        Turns: '',
        Composer: '',
        Reasoning: '',
        Busy: '',
      }];
    }
  },
});
