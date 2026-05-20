import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { ensureApplet, ggbListObjects } from './utils.js';

cli({
  site: 'geogebra',
  name: 'list',
  access: 'read',
  description: 'List all geometric objects on the GeoGebra canvas',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'type', required: false, help: 'Filter by object type (e.g. "point", "line", "circle")' },
  ],
  columns: ['name', 'type', 'value', 'visible'],
  func: async (page, kwargs) => {
    const filterType = kwargs.type == null || kwargs.type === ''
      ? ''
      : String(kwargs.type).trim().toLowerCase();
    if (filterType && !/^[a-z-]+$/.test(filterType)) {
      throw new ArgumentError('type must be a GeoGebra object type like point, line, or circle');
    }
    await ensureApplet(page);
    const objects = await ggbListObjects(page, filterType);
    if (!Array.isArray(objects) || objects.length === 0) {
      throw new EmptyResultError(
        'geogebra list',
        'No objects found on the canvas. Fresh runs start a blank session; use one "eval" call, or inspect an already-bound tab through the browser workspace commands.',
      );
    }
    return objects;
  },
});
