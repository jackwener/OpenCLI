import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval, normalizeCoords, normalizeLabel, requireGgbSuccess } from './utils.js';

cli({
  site: 'geogebra',
  name: 'add-point',
  access: 'write',
  description: 'Create a point with given label and coordinates',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra add-point --name A --coords 1,2',
  args: [
    { name: 'name', required: true, help: 'Point label (e.g. A, B, P1)' },
    { name: 'coords', required: true, help: 'Coordinates as x,y (e.g. "1,2")' },
  ],
  columns: ['name', 'x', 'y'],
  func: async (page, kwargs) => {
    const name = normalizeLabel(kwargs.name, 'name');
    const [x, y] = normalizeCoords(kwargs.coords);
    const cmd = `${name}=(${x},${y})`;
    await ensureApplet(page);
    const result = requireGgbSuccess(await ggbEval(page, cmd), `Failed to create point: ${cmd}`);
    return [{ name, x, y }];
  },
});
