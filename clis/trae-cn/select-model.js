import { cli, Strategy } from '@jackwener/opencli/registry';
import { selectTraeModel } from './utils.js';

export const selectModelCommand = cli({
  site: 'trae-cn',
  name: 'select-model',
  access: 'write',
  description: 'Select a model in the current Trae CN chat input',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn select-model "GPT 5.4" -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'name', required: true, positional: true, help: 'Model label, for example GPT 5.4 or GPT-5.4' }],
  columns: ['Status', 'Requested', 'Selected', 'Workspace', 'Agent'],
  func: async (page, kwargs) => {
    const result = await selectTraeModel(page, kwargs.name);
    return [{
      Status: 'Success',
      Requested: result.requested,
      Selected: result.selected,
      Workspace: result.workspace,
      Agent: result.agent,
    }];
  },
});
