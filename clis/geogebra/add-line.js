import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { ensureApplet, ggbEval, normalizeLabelList, requireGgbSuccess } from './utils.js';

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
    const [a, b] = normalizeLabelList(kwargs.points, 'points', 2, 2);
    const type = kwargs.type || 'line';
    const geogebraCmd = {
      line: `Line(${a},${b})`,
      segment: `Segment(${a},${b})`,
      ray: `Ray(${a},${b})`,
    }[type];
    if (!geogebraCmd) {
      throw new ArgumentError('type must be one of: line, segment, ray');
    }
    await ensureApplet(page);
    const result = requireGgbSuccess(await ggbEval(page, geogebraCmd), `Failed to create ${type}: ${geogebraCmd}`);
    return [{ label: result.label, type, points: `${a},${b}` }];
  },
});
