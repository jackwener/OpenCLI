import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval } from './utils.js';

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
    await ensureApplet(page);
    const { name, coords } = kwargs;
    const parts = String(coords).split(',').map(s => s.trim());
    if (parts.length !== 2) throw new Error('coords must be in "x,y" format (e.g. "1,2")');
    const [x, y] = parts;
    const cmd = `${name}=(${x},${y})`;
    const result = await ggbEval(page, cmd);
    if (!result.ok) throw new Error(`Failed to create point: ${cmd}`);
    return [{ name, x, y }];
  },
});
