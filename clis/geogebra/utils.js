import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

/**
 * Shared utilities for GeoGebra adapters.
 *
 * GeoGebra Geometry exposes a `ggbApplet` JavaScript API on the page after
 * the GWT-compiled app initializes. All adapters share the same pattern:
 * navigate → wait for applet → call API via page.evaluate().
 */

const GEOGEBRA_URL = 'https://www.geogebra.org/geometry';
const APPLET_WAIT_MS = 15_000;

export function unwrapBridgeEnvelope(value) {
  if (value && typeof value === 'object' && 'data' in value && 'session' in value) {
    return value.data;
  }
  return value;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeLabel(value, label = 'label') {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(normalized)) {
    throw new ArgumentError(`${label} must be an ASCII GeoGebra label like A, B1, or poly_1`);
  }
  return normalized;
}

export function normalizeLabelList(value, label, min, max = Infinity) {
  const parts = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < min || parts.length > max) {
    throw new ArgumentError(`${label} must contain ${min === max ? min : `${min}-${max}`} comma-separated labels`);
  }
  return parts.map((part, idx) => normalizeLabel(part, `${label}[${idx + 1}]`));
}

export function normalizeNumber(value, label, { defaultValue, positive = false } = {}) {
  const raw = value == null || value === '' ? defaultValue : value;
  const number = Number(raw);
  if (!Number.isFinite(number) || (positive && number <= 0)) {
    throw new ArgumentError(`${label} must be a ${positive ? 'positive ' : ''}finite number`);
  }
  return number;
}

export function normalizeCoords(value) {
  const parts = String(value ?? '').split(',').map(s => s.trim());
  if (parts.length !== 2) {
    throw new ArgumentError('coords must be in "x,y" format (e.g. "1,2")');
  }
  return parts.map((part, idx) => normalizeNumber(part, idx === 0 ? 'x' : 'y'));
}

export function requireGgbSuccess(result, message) {
  if (!isPlainObject(result)) {
    throw new CommandExecutionError(`${message}: malformed GeoGebra result`);
  }
  if (!result.ok) {
    throw new CommandExecutionError(result.error || message);
  }
  return result;
}

/**
 * Navigate to GeoGebra Geometry (if not already there) and wait for
 * the ggbApplet API to become available.
 */
export async function ensureApplet(page) {
  let currentUrl = '';
  try {
    currentUrl = await page.getCurrentUrl();
  } catch {
    currentUrl = '';
  }
  // If already on the geometry page, check if applet is ready without re-navigating
  if (currentUrl?.includes('geogebra.org/geometry')) {
    try {
      const ready = unwrapBridgeEnvelope(await page.evaluate(`typeof ggbApplet !== 'undefined' && typeof ggbApplet.evalCommand === 'function'`));
      if (ready) return;
    } catch (err) {
      throw new CommandExecutionError(`Failed to detect GeoGebra applet: ${err?.message || err}`);
    }
  }
  // Navigate to GeoGebra Geometry
  try {
    await page.goto(GEOGEBRA_URL);
  } catch (err) {
    throw new CommandExecutionError(`Failed to load GeoGebra Geometry: ${err?.message || err}`);
  }

  let ready;
  try {
    ready = unwrapBridgeEnvelope(await page.evaluate(`
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
    `));
  } catch (err) {
    throw new CommandExecutionError(`Failed to detect GeoGebra applet: ${err?.message || err}`);
  }
  if (ready !== true) {
    throw new CommandExecutionError('ggbApplet not available after waiting. Make sure the GeoGebra Geometry page is fully loaded.');
  }
}

/**
 * Execute a GeoGebra command string via ggbApplet.evalCommandGetLabels.
 * evalCommandGetLabels both executes the command and returns the created
 * object label(s). We use it instead of evalCommand to avoid double-execution.
 * Returns { ok, label } where label is the resulting object label(s).
 */
export async function ggbEval(page, cmd) {
  let result;
  try {
    result = unwrapBridgeEnvelope(await page.evaluate(`
      (cmd => {
        if (typeof ggbApplet === 'undefined' || typeof ggbApplet.evalCommandGetLabels !== 'function') {
          return { ok: false, label: '', beforeCount: 0, afterCount: 0, error: 'ggbApplet is not ready' };
        }
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
    `));
  } catch (err) {
    throw new CommandExecutionError(`Failed to execute GeoGebra command: ${err?.message || err}`);
  }
  if (!isPlainObject(result) || typeof result.ok !== 'boolean') {
    throw new CommandExecutionError('GeoGebra command returned malformed result');
  }
  return result;
}

/**
 * List all currently known GeoGebra objects, optionally filtered by type.
 */
export async function ggbListObjects(page, filterType) {
  const normalizedFilter = filterType ? String(filterType).toLowerCase() : '';
  let objects;
  try {
    objects = unwrapBridgeEnvelope(await page.evaluate(`
      (filterType => {
        const api = ggbApplet;
        let names = api.getAllObjectNames();
        if (typeof names === 'string') {
          names = names.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (!Array.isArray(names)) return { error: 'Object names are not an array' };
        const result = [];
        for (const name of names) {
          try {
            const type = api.getObjectType(name);
            if (!type) return { error: 'Object has no type', name };
            if (filterType && type.toLowerCase() !== filterType) continue;
            result.push({
              name,
              type,
              value: api.getValueString(name) || '',
              visible: api.getVisible(name),
            });
          } catch (err) {
            return { error: err?.message || String(err), name };
          }
        }
        return result;
      })(${JSON.stringify(normalizedFilter)})
    `));
  } catch (err) {
    throw new CommandExecutionError(`Failed to list GeoGebra objects: ${err?.message || err}`);
  }
  if (objects && typeof objects === 'object' && !Array.isArray(objects) && objects.error) {
    const nameSuffix = objects.name ? ` for ${objects.name}` : '';
    throw new CommandExecutionError(`Failed to list GeoGebra objects${nameSuffix}: ${objects.error}`);
  }
  if (!Array.isArray(objects)) {
    throw new CommandExecutionError('GeoGebra object list returned malformed result');
  }
  return objects;
}

/**
 * Poll until the object count reaches the requested minimum.
 */
export async function ggbWaitForObjectCount(page, minCount, timeoutMs = 4_000) {
  const normalizedMinCount = normalizeNumber(minCount, 'minCount', { positive: true });
  const normalizedTimeoutMs = normalizeNumber(timeoutMs, 'timeoutMs', { positive: true });
  let count;
  try {
    count = unwrapBridgeEnvelope(await page.evaluate(`
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
    `));
  } catch (err) {
    throw new CommandExecutionError(`Failed waiting for GeoGebra object count: ${err?.message || err}`);
  }
  if (!Number.isFinite(Number(count))) {
    throw new CommandExecutionError('GeoGebra object count returned malformed result');
  }
  return Number(count);
}

/**
 * Read a property from a GeoGebra object.
 */
export async function ggbGetProperty(page, objName, property) {
  try {
    return unwrapBridgeEnvelope(await page.evaluate(`
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
    `, objName, property));
  } catch (err) {
    throw new CommandExecutionError(`Failed to read GeoGebra object property: ${err?.message || err}`);
  }
}
