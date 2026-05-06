import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval } from './utils.js';

cli({
  site: 'geogebra',
  name: 'add-line',
  access: 'write',
  description: 'Create a line through two points or a segment between two points',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra add-line --points A,B --type segment',
  args: [
    { name: 'points', required: true, help: 'Two point labels separated by comma (e.g. "A,B")' },
    { name: 'type', required: false, choices: ['line', 'segment', 'ray'], default: 'line', help: 'Type: line, segment, or ray (default: line)' },
  ],
  columns: ['label', 'type', 'points'],
  func: async (page, kwargs) => {
    await ensureApplet(page);
    const parts = String(kwargs.points).split(',').map(s => s.trim());
    if (parts.length !== 2) throw new Error('points must be two labels separated by comma (e.g. "A,B")');
    const [a, b] = parts;
    const type = kwargs.type || 'line';

    const geogebraCmd = {
      line: `Line(${a},${b})`,
      segment: `Segment(${a},${b})`,
      ray: `Ray(${a},${b})`,
    }[type];
    if (!geogebraCmd) throw new Error(`Unknown line type: ${type}`);

    const result = await ggbEval(page, geogebraCmd);
    if (!result.ok) throw new Error(`Failed to create ${type}: ${geogebraCmd}`);
    return [{ label: result.label, type, points: `${a},${b}` }];
  },
});
