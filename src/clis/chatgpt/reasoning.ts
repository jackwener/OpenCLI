import { CliError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  chatGPTCDPHint,
  hasChatGPTCDPConfigured,
  probeChatGPTReasoningCDP,
  switchChatGPTReasoningCDP,
} from './cdp.js';

export const reasoningCommand = cli({
  site: 'chatgpt',
  name: 'reasoning',
  description: 'Get or switch the top-level ChatGPT reasoning mode in experimental CDP mode',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'mode',
      required: false,
      positional: true,
      help: 'Reasoning mode to switch to (instant, thinking, pro; alias: auto → instant)',
    },
  ],
  columns: ['Status', 'Mode', 'Reasoning', 'Requested'],
  func: async (_page: IPage | null, kwargs: any) => {
    if (!hasChatGPTCDPConfigured()) {
      throw new CliError(
        'CONFIG',
        'ChatGPT reasoning switching currently requires experimental CDP mode.',
        chatGPTCDPHint(),
      );
    }

    const mode = kwargs.mode as string | undefined;
    if (!mode) {
      const state = await probeChatGPTReasoningCDP();
      return [{
        Status: 'Active',
        Mode: 'CDP',
        Reasoning: state.label || 'Unknown',
        Requested: '',
      }];
    }

    const result = await switchChatGPTReasoningCDP(mode);
    return [{
      Status: result.status,
      Mode: 'CDP',
      Reasoning: result.reasoningLabel || result.requestedLabel,
      Requested: result.requestedLabel,
    }];
  },
});
