import { cli, Strategy } from '@jackwener/opencli/registry';
import { sendTraePrompt } from './utils.js';

export const sendCommand = cli({
  site: 'trae-cn',
  name: 'send',
  access: 'write',
  description: 'Send a prompt into the current Trae CN chat input',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn send "请执行你的任务" -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Text to send into Trae CN' }],
  columns: ['Status', 'InjectedText', 'SubmitMode'],
  func: async (page, kwargs) => {
    const result = await sendTraePrompt(page, kwargs.text);
    return [{
      Status: 'Success',
      InjectedText: result.prompt,
      SubmitMode: result.mode,
    }];
  },
});
