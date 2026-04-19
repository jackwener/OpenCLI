import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'comfyui',
  name: 'run',
  description: 'Execute a ComfyUI workflow (pass a JSON workflow prompt string or a path to a JSON file)',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'prompt', type: 'str', required: true, positional: true, description: 'Workflow prompt as JSON string or path to a JSON file' },
    { name: 'client_id', type: 'str', default: 'opencli', description: 'Client ID for tracking the task' },
  ],
  columns: ['status', 'prompt_id', 'queue_number'],
  func: async (page, kwargs) => {
    let promptObj;
    try {
      promptObj = JSON.parse(kwargs.prompt);
    } catch (e) {
      try {
        const { readFileSync } = await import('fs');
        promptObj = JSON.parse(readFileSync(kwargs.prompt, 'utf-8'));
      } catch (fileErr) {
        throw new CommandExecutionError(`Failed to parse prompt: ${e.message}, and could not read file: ${kwargs.prompt}`);
      }
    }

    const res = await fetch(url('/prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptObj, client_id: kwargs.client_id }),
    });
    const data = await res.json();

    if (data.error) {
      throw new CommandExecutionError(`${data.error.type}: ${data.error.message}`);
    }

    return [{
      status: 'submitted',
      prompt_id: data.prompt_id || 'unknown',
      queue_number: data.number ?? '-',
      node_errors: Object.keys(data.node_errors || {}).length > 0
        ? Object.keys(data.node_errors).join(', ')
        : 'none',
    }];
  },
});
