import { cli, Strategy } from '../../registry.js';
import { url } from './config.js';

cli({
  site: 'comfyui',
  name: 'search-node',
  description: 'Search ComfyUI nodes by keyword (matches node name and input field names)',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'query', type: 'str', required: true, positional: true },
    { name: 'limit', type: 'int', default: 30 },
  ],
  columns: ['rank', 'name', 'match_type', 'matching_fields'],
  func: async (page, kwargs) => {
    const res = await fetch(url('/api/object_info'));
    const data = await res.json();
    const query = kwargs.query.toLowerCase();
    const results = [];

    for (const [name, info] of Object.entries(data)) {
      const nameMatch = name.toLowerCase().includes(query);
      const inputs = info.input || {};
      const allFields = [...Object.keys(inputs.required || {}), ...Object.keys(inputs.optional || {})];
      const matchingFields = allFields.filter(f => f.toLowerCase().includes(query));

      if (nameMatch || matchingFields.length > 0) {
        results.push({
          name,
          match_type: nameMatch ? 'name' : 'field',
          matching_fields: nameMatch ? name : matchingFields.slice(0, 5).join(', '),
          total_fields: allFields.length,
        });
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results.slice(0, kwargs.limit).map((item, index) => ({ rank: index + 1, ...item }));
  },
});
