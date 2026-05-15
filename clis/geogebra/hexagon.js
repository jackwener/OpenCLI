import { cli, Strategy } from '@jackwener/opencli/registry';
import os from 'node:os';
import path from 'node:path';
import { ensureApplet, ggbEval, ggbListObjects, ggbWaitForObjectCount } from './utils.js';

/**
 * Draw a regular hexagon on the GeoGebra Geometry canvas.
 * Creates center point, vertex, and the regular polygon in one session.
 */
cli({
  site: 'geogebra',
  name: 'hexagon',
  access: 'write',
  description: 'Draw a regular hexagon centered at the origin',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra hexagon --size 3',
  args: [
    { name: 'size', required: false, default: '2', help: 'Radius of the hexagon (default: 2)' },
  ],
  columns: ['step', 'result'],
  func: async (page, kwargs) => {
    await ensureApplet(page);
    const size = Number(kwargs.size) || 2;
    const results = [];

    const vertices = [
      ['V1', `(${size},0)`],
      ['V2', `(${size}*cos(pi/3),${size}*sin(pi/3))`],
      ['V3', `(${size}*cos(2*pi/3),${size}*sin(2*pi/3))`],
      ['V4', `(-${size},0)`],
      ['V5', `(${size}*cos(4*pi/3),${size}*sin(4*pi/3))`],
      ['V6', `(${size}*cos(5*pi/3),${size}*sin(5*pi/3))`],
    ];
    for (const [name, coords] of vertices) {
      const result = await ggbEval(page, `${name}=${coords}`);
      if (!result.ok) throw new Error(result.error || `Failed to create point ${name}`);
      results.push({ step: `${name}=${coords}`, result: `ok (${result.label || name})` });
    }

    const polygon = await ggbEval(page, 'Hexagon=Polygon(V1,V2,V3,V4,V5,V6)');
    if (!polygon.ok) throw new Error(polygon.error || 'Failed to create hexagon polygon');
    results.push({ step: 'Hexagon=Polygon(V1,V2,V3,V4,V5,V6)', result: `ok (${polygon.label || 'hexagon created'})` });

    const objectCount = await ggbWaitForObjectCount(page, 7);
    const objects = await ggbListObjects(page);
    const screenshotPath = path.join(os.tmpdir(), 'opencli-geogebra-hexagon.png');
    await page.screenshot({ path: screenshotPath });

    if (Array.isArray(objects) && objects.length > 0) {
      results.push({ step: `canvas has ${objectCount} objects`, result: objects.map(o => `${o.name}(${o.type})`).join(', ') });
    }
    results.push({ step: 'screenshot', result: screenshotPath });

    return results;
  },
});
