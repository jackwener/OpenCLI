/**
 * Shared XHR/Fetch interceptor JavaScript generators.
 *
 * Provides a single source of truth for monkey-patching browser
 * fetch() and XMLHttpRequest to capture API responses matching
 * a URL pattern. Used by:
 *   - Page.installInterceptor()  (browser.ts)
 *   - stepIntercept              (pipeline/steps/intercept.ts)
 *   - stepTap                    (pipeline/steps/tap.ts)
 */

/**
 * Helper: define a non-enumerable property on window.
 * Avoids detection via Object.keys(window) or for..in loops.
 */
const DEFINE_HIDDEN = `
      function __defHidden(obj, key, val) {
        try {
          Object.defineProperty(obj, key, { value: val, writable: true, enumerable: false, configurable: true });
        } catch { obj[key] = val; }
      }`;

/**
 * Helper: disguise a patched function so toString() returns native code signature.
 */
const DISGUISE_FN = `
      function __disguise(fn, name) {
        const nativeStr = 'function ' + name + '() { [native code] }';
        // Override toString on the instance AND patch Function.prototype.toString
        // to handle Function.prototype.toString.call(fn) bypasses.
        const _origToString = Function.prototype.toString;
        const _patchedFns = window.__dFns || (function() {
          const m = new Map();
          Object.defineProperty(window, '__dFns', { value: m, enumerable: false, configurable: true });
          // Patch Function.prototype.toString once to consult the map
          Object.defineProperty(Function.prototype, 'toString', {
            value: function() {
              const override = m.get(this);
              return override !== undefined ? override : _origToString.call(this);
            },
            writable: true, configurable: true
          });
          return m;
        })();
        _patchedFns.set(fn, nativeStr);
        try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch {}
        return fn;
      }`;

/**
 * Generate JavaScript source that installs a fetch/XHR interceptor.
 * Captured responses are pushed to `window.__opencli_intercepted`.
 *
 * @param patternExpr - JS expression resolving to a URL substring to match (e.g. a JSON.stringify'd string)
 * @param opts.arrayName - Global array name for captured data (default: '__opencli_intercepted')
 * @param opts.patchGuard - Global boolean name to prevent double-patching (default: '__opencli_interceptor_patched')
 */
export function generateInterceptorJs(
  patternExpr: string,
  opts: { arrayName?: string; patchGuard?: string } = {},
): string {
  const arr = opts.arrayName ?? '__opencli_intercepted';
  const guard = opts.patchGuard ?? '__opencli_interceptor_patched';

  // Store the current pattern in a separate global so it can be updated
  // without re-patching fetch/XHR (the patchGuard only prevents double-patching).
  const patternVar = `${guard}_pattern`;

  return `
    () => {
      ${DEFINE_HIDDEN}
      ${DISGUISE_FN}

      if (!window.${arr}) __defHidden(window, '${arr}', []);
      if (!window.${arr}_errors) __defHidden(window, '${arr}_errors', []);
      __defHidden(window, '${patternVar}', ${patternExpr});
      const __checkMatch = (url) => window.${patternVar} && url.includes(window.${patternVar});

      if (!window.${guard}) {
        // ── Patch fetch ──
        const __origFetch = window.fetch;
        window.fetch = __disguise(async function(...args) {
          const reqUrl = typeof args[0] === 'string' ? args[0]
            : (args[0] && args[0].url) || '';
          const response = await __origFetch.apply(this, args);
          if (__checkMatch(reqUrl)) {
            try {
              const clone = response.clone();
              const json = await clone.json();
              window.${arr}.push(json);
            } catch(e) { window.${arr}_errors.push({ url: reqUrl, error: String(e) }); }
          }
          return response;
        }, 'fetch');

        // ── Patch XMLHttpRequest ──
        const __XHR = XMLHttpRequest.prototype;
        const __origOpen = __XHR.open;
        const __origSend = __XHR.send;
        __XHR.open = __disguise(function(method, url) {
          Object.defineProperty(this, '__iurl', { value: String(url), writable: true, enumerable: false, configurable: true });
          return __origOpen.apply(this, arguments);
        }, 'open');
        __XHR.send = __disguise(function() {
          if (__checkMatch(this.__iurl)) {
            this.addEventListener('load', function() {
              try {
                window.${arr}.push(JSON.parse(this.responseText));
              } catch(e) { window.${arr}_errors.push({ url: this.__iurl, error: String(e) }); }
            });
          }
          return __origSend.apply(this, arguments);
        }, 'send');

        __defHidden(window, '${guard}', true);
      }
    }
  `;
}

/**
 * Generate JavaScript source to read and clear intercepted data.
 */
export function generateReadInterceptedJs(arrayName: string = '__opencli_intercepted'): string {
  return `
    () => {
      const data = window.${arrayName} || [];
      window.${arrayName} = [];
      return data;
    }
  `;
}

/**
 * Generate a self-contained tap interceptor for store-action bridge.
 * Unlike the global interceptor, this one:
 * - Installs temporarily, restores originals in finally block
 * - Resolves a promise on first capture (for immediate await)
 * - Returns captured data directly
 *
 * Reuses the shared DISGUISE_FN for consistent toString() disguising.
 */
export function generateTapInterceptorJs(patternExpr: string): {
  setupVar: string;
  capturedVar: string;
  promiseVar: string;
  resolveVar: string;
  fetchPatch: string;
  xhrPatch: string;
  restorePatch: string;
} {
  return {
    setupVar: `
      let captured = null;
      let captureResolve;
      const capturePromise = new Promise(r => { captureResolve = r; });
      const capturePattern = ${patternExpr};
      ${DISGUISE_FN}
    `,
    capturedVar: 'captured',
    promiseVar: 'capturePromise',
    resolveVar: 'captureResolve',
    fetchPatch: `
      const origFetch = window.fetch;
      window.fetch = __disguise(async function(...fetchArgs) {
        const resp = await origFetch.apply(this, fetchArgs);
        try {
          const url = typeof fetchArgs[0] === 'string' ? fetchArgs[0]
            : fetchArgs[0] instanceof Request ? fetchArgs[0].url : String(fetchArgs[0]);
          if (capturePattern && url.includes(capturePattern) && !captured) {
            try { captured = await resp.clone().json(); captureResolve(); } catch {}
          }
        } catch {}
        return resp;
      }, 'fetch');
    `,
    xhrPatch: `
      const origXhrOpen = XMLHttpRequest.prototype.open;
      const origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = __disguise(function(method, url) {
        Object.defineProperty(this, '__iurl', { value: String(url), writable: true, enumerable: false, configurable: true });
        return origXhrOpen.apply(this, arguments);
      }, 'open');
      XMLHttpRequest.prototype.send = __disguise(function(body) {
        if (capturePattern && this.__iurl?.includes(capturePattern)) {
          this.addEventListener('load', function() {
            if (!captured) {
              try { captured = JSON.parse(this.responseText); captureResolve(); } catch {}
            }
          });
        }
        return origXhrSend.apply(this, arguments);
      }, 'send');
    `,
    restorePatch: `
      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origXhrOpen;
      XMLHttpRequest.prototype.send = origXhrSend;
    `,
  };
}
