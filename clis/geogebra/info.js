import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { ensureApplet, ggbGetProperty, normalizeLabel, unwrapBridgeEnvelope } from './utils.js';

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
    const objName = normalizeLabel(kwargs.name, 'name');
    await ensureApplet(page);

    let exists;
    try {
      exists = unwrapBridgeEnvelope(await page.evaluate(`
        (name => {
          try {
            if (typeof ggbApplet === 'undefined' || typeof ggbApplet.getObjectType !== 'function') {
              return { error: 'ggbApplet is not ready' };
            }
            return { ok: true, exists: ggbApplet.getObjectType(name) !== '' };
          } catch (err) {
            return { error: err?.message || String(err) };
          }
        })
        (${JSON.stringify(objName)})
      `));
    } catch (err) {
      throw new CommandExecutionError(`Failed to inspect GeoGebra object: ${err?.message || err}`);
    }
    if (!exists || typeof exists !== 'object' || Array.isArray(exists)) {
      throw new CommandExecutionError('GeoGebra object existence probe returned malformed result');
    }
    if (exists.error) {
      throw new CommandExecutionError(`Failed to inspect GeoGebra object: ${exists.error}`);
    }
    if (exists.ok !== true || typeof exists.exists !== 'boolean') {
      throw new CommandExecutionError('GeoGebra object existence probe returned malformed result');
    }
    if (exists.exists === false) {
      throw new EmptyResultError(`geogebra info ${objName}`, `Object "${objName}" not found on the canvas.`);
    }

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
