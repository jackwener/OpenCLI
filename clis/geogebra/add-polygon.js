import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval } from './utils.js';

cli({
  site: 'geogebra',
  name: 'add-polygon',
  access: 'write',
  description: 'Create a polygon from a list of point labels',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra add-polygon --points A,B,C',
  args: [
    { name: 'points', required: true, help: 'Comma-separated point labels (e.g. "A,B,C" or "A,B,C,D")' },
  ],
  columns: ['label', 'vertices'],
  func: async (page, kwargs) => {
    await ensureApplet(page);
    const points = String(kwargs.points).split(',').map(s => s.trim()).filter(Boolean);
    if (points.length < 3) throw new Error('At least 3 points required for a polygon');
    const cmd = `Polygon(${points.join(',')})`;
    const result = await ggbEval(page, cmd);
    if (!result.ok) throw new Error(`Failed to create polygon: ${cmd}`);
    return [{ label: result.label, vertices: points.join(',') }];
  },
});
