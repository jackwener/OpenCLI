/**
 * Browser-injected interceptor scripts for recording API calls.
 *
 * Generates JS code that patches fetch/XHR to capture all JSON responses.
 */

/**
 * Generates a full-capture interceptor that stores {url, method, status, body}
 * for every JSON response. No URL pattern filter — captures everything.
 */
export function generateFullCaptureInterceptorJs(): string {
  return `
    (() => {
      // Restore original fetch/XHR if previously patched, then re-patch (idempotent injection)
      if (window.__opencli_record_patched) {
        if (window.__opencli_orig_fetch) window.fetch = window.__opencli_orig_fetch;
        if (window.__opencli_orig_xhr_open) XMLHttpRequest.prototype.open = window.__opencli_orig_xhr_open;
        if (window.__opencli_orig_xhr_send) XMLHttpRequest.prototype.send = window.__opencli_orig_xhr_send;
        window.__opencli_record_patched = false;
      }
      // Preserve existing capture buffer across re-injections
      window.__opencli_record = window.__opencli_record || [];

      const _push = (url, method, body) => {
        try {
          // Only capture JSON-like responses
          if (typeof body !== 'object' || body === null) return;
          // Skip tiny/trivial responses (tracking pixels, empty acks)
          const keys = Object.keys(body);
          if (keys.length < 2) return;
          window.__opencli_record.push({
            url: String(url),
            method: String(method).toUpperCase(),
            status: null,
            body,
            ts: Date.now(),
          });
        } catch {}
      };

      // Patch fetch — save original for future restore
      window.__opencli_orig_fetch = window.fetch;
      window.fetch = async function(...args) {
        const req = args[0];
        const reqUrl = typeof req === 'string' ? req : (req instanceof Request ? req.url : String(req));
        const method = (args[1]?.method || (req instanceof Request ? req.method : 'GET') || 'GET');
        const res = await window.__opencli_orig_fetch.apply(this, args);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) {
          try {
            const body = await res.clone().json();
            _push(reqUrl, method, body);
          } catch {}
        }
        return res;
      };

      // Patch XHR — save originals for future restore
      const _XHR = XMLHttpRequest.prototype;
      window.__opencli_orig_xhr_open = _XHR.open;
      window.__opencli_orig_xhr_send = _XHR.send;
      _XHR.open = function(method, url) {
        this.__rec_url = String(url);
        this.__rec_method = String(method);
        this.__rec_listener_added = false;  // reset per open() call
        return window.__opencli_orig_xhr_open.apply(this, arguments);
      };
      _XHR.send = function() {
        // Guard: only add one listener per XHR instance to prevent duplicate captures
        if (!this.__rec_listener_added) {
          this.__rec_listener_added = true;
          this.addEventListener('load', function() {
            const ct = this.getResponseHeader?.('content-type') || '';
            if (ct.includes('json')) {
              try { _push(this.__rec_url, this.__rec_method || 'GET', JSON.parse(this.responseText)); } catch {}
            }
          });
        }
        return window.__opencli_orig_xhr_send.apply(this, arguments);
      };

      window.__opencli_record_patched = true;
      return 1;
    })()
  `;
}

/** Read and clear captured requests from the page */
export function generateReadRecordedJs(): string {
  return `
    (() => {
      const data = window.__opencli_record || [];
      window.__opencli_record = [];
      return data;
    })()
  `;
}
