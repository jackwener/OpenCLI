import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'comfyui',
  name: 'node-info',
  description: 'Show detailed definition of a ComfyUI node (inputs, types, defaults, constraints)',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'node', type: 'str', required: true, positional: true },
  ],
  columns: ['field', 'mode', 'type', 'default', 'range'],
  func: async (page, kwargs) => {
    const res = await fetch(url('/api/object_info'));
    const data = await res.json();
    const info = data[kwargs.node];

    if (!info) {
      const keys = Object.keys(data);
      const similar = keys.filter(n => n.toLowerCase().includes(kwargs.node.toLowerCase()));
      const hint = similar.length ? `Similar nodes: ${similar.slice(0, 5).join(', ')}` : 'No similar nodes found';
      throw new CommandExecutionError(`Node not found: "${kwargs.node}" — ${hint}`);
    }

    const result = [];
    const inputs = info.input || {};
    const required = inputs.required || {};
    const optional = inputs.optional || {};

    for (const [field, config] of Object.entries(required)) {
      const [typeDef, opts = {}] = config;
      result.push({
        field,
        mode: 'required',
        type: Array.isArray(typeDef) ? `choice[${typeDef.join(', ')}]` : String(typeDef),
        default: opts.default != null ? String(opts.default) : '-',
        range: (opts.min != null && opts.max != null) ? `${opts.min}~${opts.max}` : '',
      });
    }
    for (const [field, config] of Object.entries(optional)) {
      const [typeDef, opts = {}] = config;
      result.push({
        field,
        mode: 'optional',
        type: Array.isArray(typeDef) ? `choice[${typeDef.join(', ')}]` : String(typeDef),
        default: opts.default != null ? String(opts.default) : '-',
        range: (opts.min != null && opts.max != null) ? `${opts.min}~${opts.max}` : '',
      });
    }

    return result.map((item, index) => ({ rank: index + 1, ...item }));
  },
});
