import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';

cli({
  site: 'comfyui',
  name: 'nodes',
  description: 'List all registered node types in ComfyUI',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'limit', type: 'int', default: 9999 },
    { name: 'detail', type: 'str', default: 'none' },
  ],
  columns: ['rank', 'name', 'inputs'],
  func: async (page, kwargs) => {
    const res = await fetch(url('/api/object_info'));
    const data = await res.json();
    const names = Object.keys(data).sort((a, b) => a.localeCompare(b));

    return names.slice(0, kwargs.limit).map((name, index) => {
      const info = data[name];
      const inputs = info.input || {};
      const totalInputs = Object.keys(inputs.required || {}).length + Object.keys(inputs.optional || {}).length;
      return { rank: index + 1, name, inputs: totalInputs };
    });
  },
});
