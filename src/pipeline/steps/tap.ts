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
import { generateTapInterceptorJs } from '../../interceptor.js';

interface TapParams {
  store?: string;
  action?: string;
  capture?: string;
  timeout?: number;
  select?: string;
  framework?: string | null;
  args?: unknown[];
}

export async function stepTap(
  page: IPage | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  const cfg: TapParams = typeof params === 'object' && params !== null ? (params as TapParams) : {};
  const storeName = String(render(cfg.store ?? '', { args, data }));
  const actionName = String(render(cfg.action ?? '', { args, data }));
  const capturePattern = String(render(cfg.capture ?? '', { args, data }));
  const timeout = cfg.timeout ?? 5;
  const selectPath = cfg.select ? String(render(cfg.select, { args, data })) : null;
  const framework = cfg.framework ?? null;
  const actionArgs: unknown[] = cfg.args ?? [];

  if (!storeName || !actionName) throw new Error('tap: store and action are required');

  // Build select chain for the captured response
  const selectChain = selectPath
    ? selectPath.split('.').map((p: string) => `?.[${JSON.stringify(p)}]`).join('')
    : '';

  // Serialize action arguments
  const actionArgsRendered = actionArgs.map((a) => {
    const rendered = render(a, { args, data });
    return JSON.stringify(rendered);
  });
  const actionCall = actionArgsRendered.length
    ? `store[${JSON.stringify(actionName)}](${actionArgsRendered.join(', ')})`
    : `store[${JSON.stringify(actionName)}]()`;

  // Use shared interceptor generator for fetch/XHR patching
  const tap = generateTapInterceptorJs(JSON.stringify(capturePattern));

  const js = `
    async () => {
      // ── 1. Setup capture proxy (fetch + XHR dual interception) ──
      ${tap.setupVar}
      ${tap.fetchPatch}
      ${tap.xhrPatch}

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
        if (!${tap.capturedVar}) {
          const timeoutPromise = new Promise(r => setTimeout(r, ${timeout} * 1000));
          await Promise.race([${tap.promiseVar}, timeoutPromise]);
        }
      } finally {
        // ── 5. Always restore originals ──
        ${tap.restorePatch}
      }

      if (!${tap.capturedVar}) return { error: 'No matching response captured for pattern: ' + capturePattern };
      return ${tap.capturedVar}${selectChain} ?? ${tap.capturedVar};
    }
  `;

  return page!.evaluate(js);
}
