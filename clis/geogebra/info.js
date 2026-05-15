import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureApplet, ggbGetProperty } from './utils.js';

cli({
  site: 'geogebra',
  name: 'info',
  access: 'read',
  description: 'Get detailed properties of a GeoGebra object',
  domain: 'www.geogebra.org',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  example: 'opencli geogebra info --name A',
  args: [
    { name: 'name', required: true, help: 'Object label (e.g. A, c1, poly1)' },
  ],
  columns: ['property', 'value'],
  func: async (page, kwargs) => {
    await ensureApplet(page);
    const objName = kwargs.name;

    const exists = await page.evaluate(`
      (name => typeof ggbApplet !== 'undefined' && ggbApplet.getObjectType(name) !== '')
      (${JSON.stringify(objName)})
    `);
    if (!exists) throw new Error(`Object "${objName}" not found on the canvas`);

    const properties = ['type', 'value', 'definition', 'command', 'caption', 'visible', 'color'];
    const rows = [];
    for (const prop of properties) {
      const val = await ggbGetProperty(page, objName, prop);
      rows.push({ property: prop, value: String(val ?? '') });
    }

    // For point-like objects, also include coordinates
    const objType = await ggbGetProperty(page, objName, 'type');
    if (objType === 'point') {
      const x = await ggbGetProperty(page, objName, 'xcoord');
      const y = await ggbGetProperty(page, objName, 'ycoord');
      rows.push({ property: 'x', value: String(x ?? '') });
      rows.push({ property: 'y', value: String(y ?? '') });
    }

    return rows;
  },
});
