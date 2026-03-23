/**
 * Stealth anti-detection module.
 *
 * Generates JS code that patches browser globals to hide automation
 * fingerprints (e.g. navigator.webdriver, missing chrome object, empty
 * plugin list). Injected before page scripts run so that websites cannot
 * detect CDP / extension-based control.
 *
 * Inspired by puppeteer-extra-plugin-stealth.
 */

/** Guard flag set on `window` to prevent double-injection. */
export const STEALTH_GUARD = '__opencli_stealth_applied';

/**
 * Return a self-contained JS string that, when evaluated in a page context,
 * applies all stealth patches. Safe to call multiple times — the guard flag
 * ensures patches are applied only once.
 */
export function generateStealthJs(): string {
  return `
    (() => {
      // Guard: skip if already applied
      if (window.${STEALTH_GUARD}) return 'skipped';
      // Use defineProperty so the guard flag is non-enumerable (not a detection vector).
      Object.defineProperty(window, '${STEALTH_GUARD}', { value: true, configurable: true });

      // 1. navigator.webdriver → undefined
      //    Most common check; Playwright/Puppeteer/CDP set this to true.
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });
      } catch {}

      // 2. window.chrome stub
      //    Real Chrome exposes window.chrome with runtime, loadTimes, csi.
      //    Headless/automated Chrome may not have it.
      try {
        if (!window.chrome) {
          window.chrome = {
            runtime: {
              onConnect: { addListener: () => {}, removeListener: () => {} },
              onMessage: { addListener: () => {}, removeListener: () => {} },
            },
            loadTimes: () => ({}),
            csi: () => ({}),
          };
        }
      } catch {}

      // 3. navigator.plugins — fake population only if empty
      //    Real user browser already has plugins; only patch in automated/headless
      //    contexts where the list is empty (overwriting real plugins with fakes
      //    would be counterproductive and detectable).
      try {
        if (!navigator.plugins || navigator.plugins.length === 0) {
          const fakePlugins = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '' },
          ];
          fakePlugins.item = (i) => fakePlugins[i] || null;
          fakePlugins.namedItem = (n) => fakePlugins.find(p => p.name === n) || null;
          fakePlugins.refresh = () => {};
          Object.defineProperty(navigator, 'plugins', {
            get: () => fakePlugins,
            configurable: true,
          });
        }
      } catch {}

      // 4. navigator.languages — guarantee non-empty
      //    Some automated contexts return undefined or empty array.
      try {
        if (!navigator.languages || navigator.languages.length === 0) {
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
            configurable: true,
          });
        }
      } catch {}

      // 5. Permissions.query — normalize notification permission
      //    Headless Chrome throws on Permissions.query({ name: 'notifications' }).
      try {
        const origQuery = window.Permissions?.prototype?.query;
        if (origQuery) {
          window.Permissions.prototype.query = function (parameters) {
            if (parameters?.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission, onchange: null });
            }
            return origQuery.call(this, parameters);
          };
        }
      } catch {}

      // 6. Clean automation artifacts
      //    Remove properties left by Playwright, Puppeteer, or CDP injection.
      try {
        delete window.__playwright;
        delete window.__puppeteer;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      } catch {}

      return 'applied';
    })()
  `;
}
