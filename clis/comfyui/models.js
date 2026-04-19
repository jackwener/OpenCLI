import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';

cli({
  site: 'comfyui',
  name: 'models',
  description: 'List available model files in ComfyUI',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'model_type', type: 'str', default: 'all' },
  ],
  columns: ['rank', 'type', 'name', 'count'],
  func: async (page, kwargs) => {
    const typesRes = await fetch(url('/api/models'));
    const types = await typesRes.json();

    if (kwargs.model_type !== 'all') {
      const modelRes = await fetch(url(`/api/models/${kwargs.model_type}`));
      const models = await modelRes.json();
      return typeof models === 'object' && models.length !== undefined
        ? models.map((m, idx) => ({ rank: idx + 1, type: kwargs.model_type, name: typeof m === 'string' ? m : m.name }))
        : [{ rank: 1, type: kwargs.model_type, name: typeof models === 'string' ? models : JSON.stringify(models) }];
    }

    const results = [];
    let idx = 0;
    for (const t of types) {
      const modelRes = await fetch(url(`/api/models/${t}`));
      const models = await modelRes.json();
      idx++;
      results.push({
        rank: idx,
        type: t,
        count: Array.isArray(models) ? models.length : 0,
        name: Array.isArray(models) ? models.slice(0, 3).join(', ') : JSON.stringify(models),
      });
    }
    return results;
  },
});
