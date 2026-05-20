import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval, normalizeLabelList, requireGgbSuccess } from './utils.js';

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
    const points = normalizeLabelList(kwargs.points, 'points', 3, 50);
    const cmd = `Polygon(${points.join(',')})`;
    await ensureApplet(page);
    const result = requireGgbSuccess(await ggbEval(page, cmd), `Failed to create polygon: ${cmd}`);
    return [{ label: result.label, vertices: points.join(',') }];
  },
});
