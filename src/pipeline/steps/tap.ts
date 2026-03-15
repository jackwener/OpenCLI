/**
 * Pipeline step: tap — declarative Store Action Bridge.
 *
 * Generates a self-contained IIFE that:
 * 1. Injects fetch + XHR dual interception proxy
 * 2. Finds the Pinia/Vuex store and calls the action
 * 3. Captures the response matching the URL pattern
 * 4. Auto-cleans up interception in finally block
 * 5. Returns the captured data (optionally sub-selected)
 */

import type { IPage } from '../../types.js';
import { render } from '../template.js';

export async function stepTap(page: IPage, params: any, data: any, args: Record<string, any>): Promise<any> {
  const cfg = typeof params === 'object' ? params : {};
  const storeName = String(render(cfg.store ?? '', { args, data }));
  const actionName = String(render(cfg.action ?? '', { args, data }));
  const capturePattern = String(render(cfg.capture ?? '', { args, data }));
  const timeout = cfg.timeout ?? 5;
  const selectPath = cfg.select ? String(render(cfg.select, { args, data })) : null;
  const framework = cfg.framework ?? null;
  const actionArgs = cfg.args ?? [];

  if (!storeName || !actionName) throw new Error('tap: store and action are required');

  // Build select chain for the captured response
  const selectChain = selectPath
    ? selectPath.split('.').map((p: string) => `?.[${JSON.stringify(p)}]`).join('')
    : '';

  // Serialize action arguments
  const actionArgsRendered = actionArgs.map((a: any) => {
    const rendered = render(a, { args, data });
    return JSON.stringify(rendered);
  });
  const actionCall = actionArgsRendered.length
    ? `store[${JSON.stringify(actionName)}](${actionArgsRendered.join(', ')})`
    : `store[${JSON.stringify(actionName)}]()`;

  const js = `
    async () => {
      // ── 1. Setup capture proxy (fetch + XHR dual interception) ──
      let captured = null;
      const capturePattern = ${JSON.stringify(capturePattern)};

      // Intercept fetch API
      const origFetch = window.fetch;
      window.fetch = async function(...fetchArgs) {
        const resp = await origFetch.apply(this, fetchArgs);
        try {
          const url = typeof fetchArgs[0] === 'string' ? fetchArgs[0]
            : fetchArgs[0] instanceof Request ? fetchArgs[0].url : String(fetchArgs[0]);
          if (capturePattern && url.includes(capturePattern) && !captured) {
            try { captured = await resp.clone().json(); } catch {}
          }
        } catch {}
        return resp;
      };

      // Intercept XMLHttpRequest
      const origXhrOpen = XMLHttpRequest.prototype.open;
      const origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this.__tapUrl = String(url);
        return origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (capturePattern && this.__tapUrl?.includes(capturePattern)) {
          const xhr = this;
          const origHandler = xhr.onreadystatechange;
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && !captured) {
              try { captured = JSON.parse(xhr.responseText); } catch {}
            }
            if (origHandler) origHandler.apply(this, arguments);
          };
          const origOnload = xhr.onload;
          xhr.onload = function() {
            if (!captured) { try { captured = JSON.parse(xhr.responseText); } catch {} }
            if (origOnload) origOnload.apply(this, arguments);
          };
        }
        return origXhrSend.apply(this, arguments);
      };

      try {
        // ── 2. Find store ──
        let store = null;
        const storeName = ${JSON.stringify(storeName)};
        const fw = ${JSON.stringify(framework)};

        const app = document.querySelector('#app');
        if (!fw || fw === 'pinia') {
          try {
            const pinia = app?.__vue_app__?.config?.globalProperties?.$pinia;
            if (pinia?._s) store = pinia._s.get(storeName);
          } catch {}
        }
        if (!store && (!fw || fw === 'vuex')) {
          try {
            const vuexStore = app?.__vue_app__?.config?.globalProperties?.$store
              ?? app?.__vue__?.$store;
            if (vuexStore) {
              store = { [${JSON.stringify(actionName)}]: (...a) => vuexStore.dispatch(storeName + '/' + ${JSON.stringify(actionName)}, ...a) };
            }
          } catch {}
        }

        if (!store) return { error: 'Store not found: ' + storeName, hint: 'Page may not be fully loaded or store name may be incorrect' };
        if (typeof store[${JSON.stringify(actionName)}] !== 'function') {
          return { error: 'Action not found: ' + ${JSON.stringify(actionName)} + ' on store ' + storeName,
            hint: 'Available: ' + Object.keys(store).filter(k => typeof store[k] === 'function' && !k.startsWith('$') && !k.startsWith('_')).join(', ') };
        }

        // ── 3. Call store action ──
        await ${actionCall};

        // ── 4. Wait for network response ──
        const deadline = Date.now() + ${timeout} * 1000;
        while (!captured && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 200));
        }
      } finally {
        // ── 5. Always restore originals ──
        window.fetch = origFetch;
        XMLHttpRequest.prototype.open = origXhrOpen;
        XMLHttpRequest.prototype.send = origXhrSend;
      }

      if (!captured) return { error: 'No matching response captured for pattern: ' + capturePattern };
      return captured${selectChain} ?? captured;
    }
  `;

  return page.evaluate(js);
}
