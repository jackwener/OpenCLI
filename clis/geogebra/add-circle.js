import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { ensureApplet, ggbEval, normalizeLabel, normalizeNumber, requireGgbSuccess } from './utils.js';

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
    const center = normalizeLabel(kwargs.center, 'center');
    if (kwargs.point && kwargs.radius !== undefined) {
      throw new ArgumentError('Use either --point or --radius, not both');
    }
    const pointOnCircle = kwargs.point ? normalizeLabel(kwargs.point, 'point') : '';
    const radiusValue = kwargs.radius;

    let cmd;
    if (pointOnCircle) {
      cmd = `Circle(${center},${pointOnCircle})`;
    } else if (radiusValue !== undefined) {
      const raw = String(radiusValue).trim();
      const num = Number(raw);
      cmd = Number.isFinite(num)
        ? `Circle(${center},${normalizeNumber(raw, 'radius', { positive: true })})`
        : `Circle(${center},${normalizeLabel(raw, 'radius point')})`;
    } else {
      throw new ArgumentError('Provide --radius (number or point label) or --point (point on circle)');
    }

    await ensureApplet(page);
    const result = requireGgbSuccess(await ggbEval(page, cmd), `Failed to create circle: ${cmd}`);
    return [{ label: result.label, center, radius: pointOnCircle || radiusValue }];
  },
});
