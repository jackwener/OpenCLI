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

/**
 * Return a self-contained JS string that, when evaluated in a page context,
 * applies all stealth patches. Safe to call multiple times — the guard flag
 * ensures patches are applied only once.
 */
export function generateStealthJs(): string {
  return `
    (() => {
      // Guard: prevent double-injection across separate CDP evaluations.
      // We cannot use a closure variable (each eval is a fresh scope), and
      // window properties / Symbols are discoverable by anti-bot scripts.
      // Instead, stash the flag in a non-enumerable getter on a built-in
      // prototype that fingerprinters are unlikely to scan.
      const _gProto = EventTarget.prototype;
      const _gKey = '__lsn';  // looks like an internal listener cache
      if (_gProto[_gKey]) return 'skipped';
      try {
        Object.defineProperty(_gProto, _gKey, { value: true, enumerable: false, configurable: true });
      } catch {}

      // 1. navigator.webdriver → false
      //    Most common check; Playwright/Puppeteer/CDP set this to true.
      //    Real Chrome returns false (not undefined) — returning undefined is
      //    itself a detection signal for advanced fingerprinters.
      try {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
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
        // ChromeDriver injects cdc_ prefixed globals; the suffix varies by version,
        // so scan window for any matching property rather than hardcoding names.
        for (const prop of Object.getOwnPropertyNames(window)) {
          if (prop.startsWith('cdc_') || prop.startsWith('__cdc_')) {
            try { delete window[prop]; } catch {}
          }
        }
      } catch {}

      // 7. CDP stack trace cleanup
      //    Runtime.evaluate injects scripts whose source URLs appear in Error
      //    stack traces (e.g. __puppeteer_evaluation_script__, pptr:, debugger://).
      //    Websites detect automation by doing: new Error().stack and inspecting it.
      //    We override the stack property getter on Error.prototype to filter them.
      //    Note: Error.prepareStackTrace is V8/Node-only and not available in
      //    browser page context, so we use a property descriptor approach instead.
      //    We use generic protocol patterns instead of product-specific names to
      //    also catch our own injected code frames without leaking identifiers.
      try {
        const _origDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
        const _cdpPatterns = [
          'puppeteer_evaluation_script',
          'pptr:',
          'debugger://',
          '__playwright',
          '__puppeteer',
        ];
        if (_origDescriptor && _origDescriptor.get) {
          Object.defineProperty(Error.prototype, 'stack', {
            get: function () {
              const raw = _origDescriptor.get.call(this);
              if (typeof raw !== 'string') return raw;
              return raw.split('\\n').filter(line =>
                !_cdpPatterns.some(p => line.includes(p))
              ).join('\\n');
            },
            configurable: true,
          });
        }
      } catch {}

      // ── Shared toString disguise infrastructure ──
      // Save the pristine Function.prototype.toString BEFORE any patches,
      // so all subsequent disguises use the real native reference.
      // Anti-bot scripts detect per-instance toString overrides via:
      //   Function.hasOwnProperty('toString')          → true if patched
      //   Function.prototype.toString.call(fn) !== fn.toString()
      // Instead we patch Function.prototype.toString once with a WeakMap
      // lookup, making disguised functions indistinguishable from native.
      const _origToString = Function.prototype.toString;
      const _disguised = new WeakMap();
      try {
        Object.defineProperty(Function.prototype, 'toString', {
          value: function() {
            const override = _disguised.get(this);
            return override !== undefined ? override : _origToString.call(this);
          },
          writable: true, configurable: true,
        });
      } catch {}
      const _disguise = (fn, name) => {
        _disguised.set(fn, 'function ' + name + '() { [native code] }');
        try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch {}
        return fn;
      };

      // 8. Anti-debugger statement trap
      //    Sites inject debugger statements to detect DevTools/CDP.
      //    When a CDP debugger is attached, the statement pauses execution
      //    and the site measures the time gap to confirm automation.
      //    We neutralize this by overriding the Function constructor and
      //    eval to strip debugger statements from dynamically created code.
      //    Note: this does NOT affect static debugger statements in parsed
      //    scripts — those require CDP Debugger.setBreakpointsActive(false)
      //    which we handle at the extension level.
      //    Caveat: the regex targets standalone debugger statements (preceded
      //    by a statement boundary) to minimise false positives inside string
      //    literals, but cannot perfectly distinguish all cases without a
      //    full parser. This is an acceptable trade-off for stealth code.
      try {
        const _OrigFunction = Function;
        // Match standalone debugger statements preceded by a statement
        // boundary (start of string, semicolon, brace, or newline).
        // This avoids most false positives inside string literals like
        // "use debugger mode" while still catching the anti-bot patterns.
        const _debuggerRe = /(?:^|(?<=[;{}\\n\\r]))\\s*debugger\\s*;?/g;
        const _cleanDebugger = (src) => typeof src === 'string' ? src.replace(_debuggerRe, '') : src;
        // Patch Function constructor to strip debugger from dynamic code.
        // Support both Function('code') and new Function('code') via
        // new.target / Reflect.construct.
        const _PatchedFunction = function(...args) {
          if (args.length > 0) {
            args[args.length - 1] = _cleanDebugger(args[args.length - 1]);
          }
          if (new.target) {
            return Reflect.construct(_OrigFunction, args, new.target);
          }
          return _OrigFunction.apply(this, args);
        };
        _PatchedFunction.prototype = _OrigFunction.prototype;
        Object.setPrototypeOf(_PatchedFunction, _OrigFunction);
        _disguise(_PatchedFunction, 'Function');
        try { window.Function = _PatchedFunction; } catch {}

        // Patch eval to strip debugger
        const _origEval = window.eval;
        const _patchedEval = function(code) {
          return _origEval.call(this, _cleanDebugger(code));
        };
        _disguise(_patchedEval, 'eval');
        try { window.eval = _patchedEval; } catch {}
      } catch {}

      // 9. Console method fingerprinting defense
      //    When CDP Runtime.enable is called, Chrome replaces console.log etc.
      //    with CDP-bound versions. These bound functions have a different
      //    toString() output: "function log() { [native code] }" becomes
      //    something like "function () { [native code] }" (no name) or the
      //    bound function signature leaks. Anti-bot scripts check:
      //      console.log.toString().includes('[native code]')
      //      console.log.name === 'log'
      //    We re-wrap console methods and register them via the shared
      //    _disguise infrastructure so Function.prototype.toString.call()
      //    also returns the correct native string.
      try {
        const _consoleMethods = ['log', 'warn', 'error', 'info', 'debug', 'table', 'trace', 'dir', 'group', 'groupEnd', 'groupCollapsed', 'clear', 'count', 'assert', 'profile', 'profileEnd', 'time', 'timeEnd', 'timeStamp'];
        for (const _m of _consoleMethods) {
          if (typeof console[_m] !== 'function') continue;
          const _origMethod = console[_m];
          const _nativeStr = 'function ' + _m + '() { [native code] }';
          // Only patch if toString is wrong (i.e. CDP has replaced it)
          try {
            const _currentStr = _origToString.call(_origMethod);
            if (_currentStr === _nativeStr) continue; // already looks native
          } catch {}
          const _wrapper = function() { return _origMethod.apply(console, arguments); };
          Object.defineProperty(_wrapper, 'length', { value: _origMethod.length || 0, configurable: true });
          _disguise(_wrapper, _m);
          try { console[_m] = _wrapper; } catch {}
        }
      } catch {}

      // 10. window.outerWidth/outerHeight defense
      //     When DevTools or CDP debugger is attached, Chrome may alter the
      //     window dimensions. Anti-bot scripts compare outerWidth/innerWidth
      //     and outerHeight/innerHeight — a significant difference indicates
      //     DevTools is open. We freeze the relationship so the delta stays
      //     consistent with a normal browser window.
      //     Thresholds: width delta > 100px or height delta > 200px indicates
      //     a docked DevTools panel. When triggered, we report outerWidth
      //     equal to innerWidth (normal for maximised windows) and
      //     outerHeight as innerHeight + the captured "normal" delta (capped
      //     to a reasonable range), so the result is plausible across OSes.
      try {
        const _normalWidthDelta = window.outerWidth - window.innerWidth;
        const _normalHeightDelta = window.outerHeight - window.innerHeight;
        // Only patch if the delta looks suspicious (e.g. DevTools docked)
        if (_normalWidthDelta > 100 || _normalHeightDelta > 200) {
          Object.defineProperty(window, 'outerWidth', {
            get: () => window.innerWidth,
            configurable: true,
          });
          // Use a clamped height offset (40-120px covers macOS ~78px,
          // Windows ~40px, and Linux ~37-50px title bar heights).
          const _heightOffset = Math.max(40, Math.min(120, _normalHeightDelta));
          Object.defineProperty(window, 'outerHeight', {
            get: () => window.innerHeight + _heightOffset,
            configurable: true,
          });
        }
      } catch {}

      // 11. Performance API cleanup
      //     CDP injects internal resources and timing entries that don't exist
      //     in normal browsing. Filter entries with debugger/devtools URLs.
      try {
        const _origGetEntries = Performance.prototype.getEntries;
        const _origGetByType = Performance.prototype.getEntriesByType;
        const _origGetByName = Performance.prototype.getEntriesByName;
        const _suspiciousPatterns = ['debugger', 'devtools', '__puppeteer', '__playwright', 'pptr:'];
        const _filterEntries = (entries) => {
          if (!Array.isArray(entries)) return entries;
          return entries.filter(e => {
            const name = e.name || '';
            return !_suspiciousPatterns.some(p => name.includes(p));
          });
        };
        Performance.prototype.getEntries = function() {
          return _filterEntries(_origGetEntries.call(this));
        };
        Performance.prototype.getEntriesByType = function(type) {
          return _filterEntries(_origGetByType.call(this, type));
        };
        Performance.prototype.getEntriesByName = function(name, type) {
          return _filterEntries(_origGetByName.call(this, name, type));
        };
      } catch {}

      // 12. WebDriver-related property defense
      //     Some anti-bot systems check additional navigator properties
      //     and document properties that may indicate automation.
      try {
        // document.$cdc_ properties (ChromeDriver specific, backup for #6)
        for (const _prop of Object.getOwnPropertyNames(document)) {
          if (_prop.startsWith('$cdc_') || _prop.startsWith('$chrome_')) {
            try { delete document[_prop]; } catch {}
          }
        }
      } catch {}

      // 13. Iframe contentWindow.chrome consistency
      //     Anti-bot scripts create iframes and check if
      //     iframe.contentWindow.chrome exists and matches the parent.
      //     CDP-controlled pages may have inconsistent iframe contexts.
      try {
        const _origHTMLIFrame = HTMLIFrameElement.prototype;
        const _origContentWindow = Object.getOwnPropertyDescriptor(_origHTMLIFrame, 'contentWindow');
        if (_origContentWindow && _origContentWindow.get) {
          Object.defineProperty(_origHTMLIFrame, 'contentWindow', {
            get: function() {
              const _w = _origContentWindow.get.call(this);
              if (_w) {
                try {
                  if (!_w.chrome) {
                    Object.defineProperty(_w, 'chrome', {
                      value: window.chrome,
                      writable: true,
                      configurable: true,
                    });
                  }
                } catch {}
              }
              return _w;
            },
            configurable: true,
          });
        }
      } catch {}

      return 'applied';
    })()
  `;
}
