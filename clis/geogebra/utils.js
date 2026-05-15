/**
 * Shared utilities for GeoGebra adapters.
 *
 * GeoGebra Geometry exposes a `ggbApplet` JavaScript API on the page after
 * the GWT-compiled app initializes. All adapters share the same pattern:
 * navigate → wait for applet → call API via page.evaluate().
 */

const GEOGEBRA_URL = 'https://www.geogebra.org/geometry';
const APPLET_WAIT_MS = 15_000;

/**
 * Navigate to GeoGebra Geometry (if not already there) and wait for
 * the ggbApplet API to become available.
 */
export async function ensureApplet(page) {
  const currentUrl = await page.getCurrentUrl();
  // If already on the geometry page, check if applet is ready without re-navigating
  if (currentUrl?.includes('geogebra.org/geometry')) {
    const ready = await page.evaluate(`typeof ggbApplet !== 'undefined' && typeof ggbApplet.evalCommand === 'function'`);
    if (ready) return;
  }
  // Navigate to GeoGebra Geometry
  await page.goto(GEOGEBRA_URL);

  const ready = await page.evaluate(`
    (async () => {
      const deadline = Date.now() + ${APPLET_WAIT_MS};
      while (Date.now() < deadline) {
        if (typeof ggbApplet !== 'undefined' && typeof ggbApplet.evalCommand === 'function') {
          return true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })()
  `);
  if (!ready) throw new Error('ggbApplet not available after waiting. Make sure the GeoGebra Geometry page is fully loaded.');
}

/**
 * Execute a GeoGebra command string via ggbApplet.evalCommandGetLabels.
 * evalCommandGetLabels both executes the command and returns the created
 * object label(s). We use it instead of evalCommand to avoid double-execution.
 * Returns { ok, label } where label is the resulting object label(s).
 */
export async function ggbEval(page, cmd) {
  return page.evaluate(`
    (cmd => {
      const collectNames = () => {
        let names = ggbApplet.getAllObjectNames();
        if (typeof names === 'string') {
          names = names.split(',').map(s => s.trim()).filter(Boolean);
        }
        return Array.isArray(names) ? names : [];
      };
      const beforeCount = collectNames().length;
      const label = ggbApplet.evalCommandGetLabels(cmd);
      const afterCount = collectNames().length;
      const dialogText = [...document.querySelectorAll('[role="dialog"], .gwt-DialogBox')]
        .map(node => node.textContent?.trim() || '')
        .find(text => /error|unknown command|错误|未知的指令/i.test(text)) || '';
      return {
        ok: label !== '' || afterCount > beforeCount,
        label,
        beforeCount,
        afterCount,
        error: dialogText || null,
      };
    })(${JSON.stringify(cmd)})
  `);
}

/**
 * List all currently known GeoGebra objects, optionally filtered by type.
 */
export async function ggbListObjects(page, filterType) {
  const normalizedFilter = filterType ? String(filterType).toLowerCase() : '';
  return page.evaluate(`
    (filterType => {
      const api = ggbApplet;
      let names = api.getAllObjectNames();
      if (typeof names === 'string') {
        names = names.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (!Array.isArray(names)) return [];
      const result = [];
      for (const name of names) {
        try {
          const type = api.getObjectType(name);
          if (!type) continue;
          if (filterType && type.toLowerCase() !== filterType) continue;
          result.push({
            name,
            type,
            value: api.getValueString(name) || '',
            visible: api.getVisible(name),
          });
        } catch {}
      }
      return result;
    })(${JSON.stringify(normalizedFilter)})
  `);
}

/**
 * Poll until the object count reaches the requested minimum.
 */
export async function ggbWaitForObjectCount(page, minCount, timeoutMs = 4_000) {
  const normalizedMinCount = Number(minCount);
  const normalizedTimeoutMs = Number(timeoutMs);
  return page.evaluate(`
    (async () => {
      const deadline = Date.now() + ${normalizedTimeoutMs};
      while (Date.now() < deadline) {
        let names = ggbApplet.getAllObjectNames();
        if (typeof names === 'string') {
          names = names.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (Array.isArray(names) && names.length >= ${normalizedMinCount}) {
          return names.length;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      let names = ggbApplet.getAllObjectNames();
      if (typeof names === 'string') {
        names = names.split(',').map(s => s.trim()).filter(Boolean);
      }
      return Array.isArray(names) ? names.length : 0;
    })()
  `);
}

/**
 * Read a property from a GeoGebra object.
 */
export async function ggbGetProperty(page, objName, property) {
  return page.evaluate(`
    (objName, property) => {
      const api = ggbApplet;
      switch (property) {
        case 'type': return api.getObjectType(objName);
        case 'value': return api.getValueString(objName);
        case 'color': return api.getColor(objName);
        case 'visible': return api.getVisible(objName);
        case 'caption': return api.getCaption(objName) || '';
        case 'xcoord': return api.getXcoord(objName);
        case 'ycoord': return api.getYcoord(objName);
        case 'definition': return api.getDefinitionString(objName);
        case 'command': return api.getCommandString(objName);
        default: return null;
      }
    }
  `, objName, property);
}
