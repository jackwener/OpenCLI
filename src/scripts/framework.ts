/**
 * Injected script for detecting frontend frameworks (Vue, React, Next, Nuxt, etc.)
 *
 * Serialized via `.toString()` and evaluated in the page context. Types here are
 * only for the TS boundary — see scripts/store.ts for the same pattern.
 */

interface VueAppEl {
  __vue__?: unknown;
  __vue_app__?: {
    config?: {
      globalProperties?: { $pinia?: unknown; $store?: unknown };
    };
  };
}
interface FrameworkWindow extends Window {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  __NEXT_DATA__?: unknown;
  __NUXT__?: unknown;
}

export function detectFramework() {
  const r: Record<string, boolean> = {};
  try {
    const app = document.querySelector('#app') as unknown as VueAppEl | null;
    const w = window as FrameworkWindow;
    r.vue3 = !!(app && app.__vue_app__);
    r.vue2 = !!(app && app.__vue__);
    r.react = !!w.__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot]');
    r.nextjs = !!w.__NEXT_DATA__;
    r.nuxt = !!w.__NUXT__;
    if (r.vue3 && app?.__vue_app__) {
      const gp = app.__vue_app__.config?.globalProperties;
      r.pinia = !!(gp && gp.$pinia);
      r.vuex = !!(gp && gp.$store);
    }
  } catch {}
  return r;
}
