import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'comfyui',
  name: 'history',
  description: 'View ComfyUI workflow execution history',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'limit', type: 'int', default: 10 },
    { name: 'prompt_id', type: 'str', default: '' },
  ],
  columns: ['prompt_id', 'status', 'nodes', 'output_nodes'],
  func: async (page, kwargs) => {
    const res = await fetch(url('/api/history'));
    const data = await res.json();

    if (kwargs.prompt_id) {
      const entry = data[kwargs.prompt_id];
      if (!entry) {
        throw new CommandExecutionError(`History entry not found for prompt_id: ${kwargs.prompt_id}`);
      }
      const prompt = entry.prompt || [];
      const promptData = prompt[2] || {};
      return [{
        prompt_id: kwargs.prompt_id,
        status: entry.status?.status_str || 'unknown',
        nodes: Object.keys(promptData).length,
        output_nodes: entry.outputs ? Object.keys(entry.outputs).join(', ') : '-',
      }];
    }

    const entries = Object.entries(data)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, kwargs.limit);

    return entries.map(([id, entry], index) => {
      const prompt = entry.prompt || [];
      const promptData = prompt[2] || {};
      const outputs = entry.outputs || {};
      return {
        rank: index + 1,
        prompt_id: id,
        status: entry.status?.status_str || 'unknown',
        nodes: Object.keys(promptData).length,
        output_nodes: Object.keys(outputs).length > 0 ? Object.keys(outputs).join(', ') : '-',
      };
    });
  },
});
