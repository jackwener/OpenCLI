import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval } from './utils.js';

cli({
  site: 'geogebra',
  name: 'add-circle',
  access: 'write',
  description: 'Create a circle by center+radius or center+point',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra add-circle --center A --radius 3',
  args: [
    { name: 'center', required: true, help: 'Center point label (e.g. A)' },
    { name: 'radius', required: false, help: 'Radius value (number) or a point label on the circle' },
    { name: 'point', required: false, help: 'Alternative: a point label on the circle (use instead of --radius for Circle(center,point))' },
  ],
  columns: ['label', 'center', 'radius'],
  func: async (page, kwargs) => {
    await ensureApplet(page);
    const center = kwargs.center;
    const pointOnCircle = kwargs.point;
    const radiusValue = kwargs.radius;

    let cmd;
    if (pointOnCircle) {
      cmd = `Circle(${center},${pointOnCircle})`;
    } else if (radiusValue !== undefined) {
      const num = Number(radiusValue);
      if (Number.isNaN(num)) {
        // Might be a point name
        cmd = `Circle(${center},${radiusValue})`;
      } else {
        cmd = `Circle(${center},${num})`;
      }
    } else {
      throw new Error('Provide --radius (number or point label) or --point (point on circle)');
    }

    const result = await ggbEval(page, cmd);
    if (!result.ok) throw new Error(`Failed to create circle: ${cmd}`);
    return [{ label: result.label, center, radius: pointOnCircle || radiusValue }];
  },
});
