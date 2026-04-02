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
 * Generate JavaScript source that installs a streaming-capable fetch interceptor.
 * Unlike generateInterceptorJs (which awaits full JSON), this reads the response
 * body as a ReadableStream and accumulates chunks incrementally — ideal for
 * SSE / streaming endpoints where the response never terminates during use.
 *
 * Captured data:
 *   - window.__opencli_stream_text  — accumulated decoded text
 *   - window.__opencli_sse_events   — parsed SSE events (if content is SSE)
 *   - window.__opencli_stream_done  — true when the stream ends
 *   - window.__opencli_stream_errors — array of {url, error}
 *
 * @param patternExpr - JS expression resolving to a URL substring to match
 * @param opts.arrayName - Prefix for globals (default: '__opencli_stream')
 * @param opts.patchGuard - Guard name to prevent double-patching
 * @param opts.maxChunks - Max chunks to buffer before dropping oldest (default 5000)
 */
export function generateStreamingInterceptorJs(
  patternExpr: string,
  opts: { arrayName?: string; patchGuard?: string; maxChunks?: number } = {},
): string {
  const prefix = opts.arrayName ?? '__opencli_stream';
  const guard = opts.patchGuard ?? '__opencli_stream_patched';
  const maxChunks = opts.maxChunks ?? 5000;
  const patternVar = `${guard}_pattern`;

  return `
    () => {
      ${DEFINE_HIDDEN}
      ${DISGUISE_FN}

      // Reset all capture state (including SSE buffer) so previous data
      // never leaks into a new interception session.
      __defHidden(window, '${prefix}_text', '');
      __defHidden(window, '${prefix}_events', []);
      __defHidden(window, '${prefix}_done', false);
      __defHidden(window, '${prefix}_errors', []);
      __defHidden(window, '${prefix}_sse_buf', '');
      __defHidden(window, '${patternVar}', ${patternExpr});
      const __checkMatch = (url) => window.${patternVar} && url.includes(window.${patternVar});

      if (!window.${guard}) {
        const __origFetch = window.fetch;
        window.fetch = __disguise(async function(...args) {
          const reqUrl = typeof args[0] === 'string' ? args[0]
            : (args[0] && args[0].url) || '';
          const response = await __origFetch.apply(this, args);
          if (__checkMatch(reqUrl)) {
            // Reset all state for new request (including SSE buffer)
            window.${prefix}_text = '';
            window.${prefix}_events = [];
            window.${prefix}_done = false;
            window.${prefix}_sse_buf = '';

            try {
              const clone = response.clone();
              const reader = clone.body && clone.body.getReader ? clone.body.getReader() : null;
              if (reader) {
                (async () => {
                  const decoder = new TextDecoder();
                  let sseBuffer = '';
                  let chunkCount = 0;
                  try {
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) {
                        window.${prefix}_done = true;
                        // flush remaining SSE buffer
                        if (sseBuffer.trim()) __parseSse(sseBuffer, window.${prefix}_events);
                        break;
                      }
                      const text = decoder.decode(value, { stream: true });
                      window.${prefix}_text += text;
                      chunkCount++;
                      if (chunkCount > ${maxChunks}) {
                        window.${prefix}_text = window.${prefix}_text.slice(
                          Math.floor(window.${prefix}_text.length / 2)
                        );
                        chunkCount = Math.floor(chunkCount / 2);
                      }
                      // SSE parsing: normalize CRLF, accumulate buffer, emit complete events
                      sseBuffer += text.replace(/\\r\\n/g, '\\n');
                      let boundary;
                      while ((boundary = sseBuffer.indexOf('\\n\\n')) !== -1) {
                        const block = sseBuffer.slice(0, boundary);
                        sseBuffer = sseBuffer.slice(boundary + 2);
                        __parseSse(block, window.${prefix}_events);
                      }
                    }
                  } catch(e) {
                    window.${prefix}_errors.push({ url: reqUrl, error: String(e) });
                    window.${prefix}_done = true;
                  }
                })();
              } else {
                // No ReadableStream — fall back to text()
                try {
                  window.${prefix}_text = await clone.text();
                  window.${prefix}_done = true;
                } catch(e) {
                  window.${prefix}_errors.push({ url: reqUrl, error: String(e) });
                  window.${prefix}_done = true;
                }
              }
            } catch(e) {
              window.${prefix}_errors.push({ url: reqUrl, error: String(e) });
              window.${prefix}_done = true;
            }
          }
          return response;
        }, 'fetch');

        // ── SSE parser helper (normalizes CRLF → LF) ──
        function __parseSse(block, events) {
          let currentEvent = '';
          let dataLines = [];
          for (const line of block.replace(/\\r\\n/g, '\\n').split('\\n')) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            } else if (line.startsWith(':')) {
              // SSE comment, ignore
            } else if (line === '') {
              // end of event (shouldn't happen since we split on \\n\\n, but handle gracefully)
            }
          }
          if (dataLines.length > 0) {
            const eventData = dataLines.join('\\n');
            events.push({ event: currentEvent || 'message', data: eventData });
          }
        }

        // ── Patch XMLHttpRequest (streaming via onprogress + complete via readystatechange) ──
        const __XHR = XMLHttpRequest.prototype;
        const __origXhrOpen = __XHR.open;
        const __origXhrSend = __XHR.send;
        __XHR.open = __disguise(function(method, url) {
          Object.defineProperty(this, '__${guard}_url', {
            value: String(url), writable: true, enumerable: false, configurable: true
          });
          return __origXhrOpen.apply(this, arguments);
        }, 'open');
        __XHR.send = __disguise(function() {
          if (__checkMatch(this.__${guard}_url)) {
            // Reset all capture state for new XHR request
            window.${prefix}_text = '';
            window.${prefix}_events = [];
            window.${prefix}_done = false;
            window.${prefix}_sse_buf = '';

            const xhr = this;
            let lastLen = 0;
            let settled = false;

            // onprogress: incremental capture for real-time streaming
            xhr.addEventListener('progress', function() {
              try {
                const full = xhr.responseText || '';
                const chunk = full.slice(lastLen);
                lastLen = full.length;
                if (chunk.length > 0) {
                  window.${prefix}_text += chunk;
                  const buf = window.${prefix}_sse_buf || '';
                  let combined = buf + chunk.replace(/\\r\\n/g, '\\n');
                  let boundary;
                  while ((boundary = combined.indexOf('\\n\\n')) !== -1) {
                    const block = combined.slice(0, boundary);
                    combined = combined.slice(boundary + 2);
                    __parseSse(block, window.${prefix}_events);
                  }
                  __defHidden(window, '${prefix}_sse_buf', combined);
                }
              } catch(e) {}
            });

            // readystatechange readyState=4: authoritative complete responseText
            // This is the MOST reliable way to get the full response.
            // It fires as a fallback if the load event doesn't fire.
            xhr.addEventListener('readystatechange', function() {
              if (xhr.readyState === 4 && !settled) {
                settled = true;
                try {
                  const full = xhr.responseText || '';
                  // OVERWRITE with complete responseText — guarantees completeness
                  // even if onprogress missed chunks between its last fire and completion
                  if (full.length > 0) {
                    window.${prefix}_text = full;
                  }
                } catch(e) {}
                window.${prefix}_done = true;
                const buf = window.${prefix}_sse_buf || '';
                if (buf.trim()) __parseSse(buf, window.${prefix}_events);
                __defHidden(window, '${prefix}_sse_buf', '');
              }
            });

            // load event: secondary fallback (some browsers fire load but not readystatechange=4)
            xhr.addEventListener('load', function() {
              if (settled) return; // already handled by readystatechange
              settled = true;
              try {
                const full = xhr.responseText || '';
                if (full.length > 0) {
                  window.${prefix}_text = full;
                }
              } catch(e) {}
              window.${prefix}_done = true;
              const buf = window.${prefix}_sse_buf || '';
              if (buf.trim()) __parseSse(buf, window.${prefix}_events);
              __defHidden(window, '${prefix}_sse_buf', '');
            });

            xhr.addEventListener('error', function() {
              if (!settled) {
                settled = true;
                window.${prefix}_errors.push({ url: xhr.__${guard}_url, error: 'XHR error' });
                window.${prefix}_done = true;
              }
            });
          }
          return __origXhrSend.apply(this, arguments);
        }, 'send');

        __defHidden(window, '${guard}', true);
      }
    }
  `;
}

/**
 * Generate JavaScript source to read (and optionally clear) streaming interceptor state.
 * Returns { text, events, done, errors }.
 *
 * @param prefix - Global variable prefix (default: '__opencli_stream')
 * @param clear - Whether to clear state after reading (default: true for backwards compat)
 */
export function generateReadStreamJs(
  prefix: string = '__opencli_stream',
  clear: boolean = true,
): string {
  const clearStmt = clear ? `
      window.${prefix}_text = '';
      window.${prefix}_events = [];
      window.${prefix}_done = false;
      window.${prefix}_errors = [];
      window.${prefix}_sse_buf = '';
    ` : '';
  return `
    () => {
      const result = {
        text: window.${prefix}_text || '',
        events: window.${prefix}_events || [],
        done: window.${prefix}_done || false,
        errors: window.${prefix}_errors || [],
      };
      ${clearStmt}
      return result;
    }
  `;
}

/**
 * Generate a self-contained tap interceptor for store-action bridge.
 * Unlike the global interceptor, this one:
 * - Installs temporarily, restores originals in finally block
 * - Resolves a promise on first capture (for immediate await)
 * - Returns captured data directly
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
      function __disguise(fn, name) {
        const s = 'function ' + name + '() { [native code] }';
        Object.defineProperty(fn, 'toString', { value: function() { return s; }, writable: true, configurable: true, enumerable: false });
        try { Object.defineProperty(fn, 'name', { value: name, configurable: true }); } catch {}
        return fn;
      }
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
