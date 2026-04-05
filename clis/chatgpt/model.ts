import { cli, Strategy } from '@jackwener/opencli/registry';
import { ConfigError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';
import { activateChatGPT, selectModel, MODEL_CHOICES } from './ax.js';

export const modelCommand = cli({
  site: 'chatgpt',
  name: 'model',
  description: 'Switch ChatGPT Desktop model/mode (auto, instant, thinking, 5.2-instant, 5.2-thinking)',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'model', required: true, positional: true, help: 'Model to switch to', choices: MODEL_CHOICES },
  ],
  columns: ['Status', 'Model'],
  func: async (page: IPage | null, kwargs: any) => {
    if (process.platform !== 'darwin') {
      throw new ConfigError('ChatGPT Desktop integration requires macOS');
    }

    const model = kwargs.model as string;
    activateChatGPT();
    const result = selectModel(model);
    return [{ Status: 'Success', Model: result }];
  },
});
