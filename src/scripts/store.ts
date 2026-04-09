/**
 * Injected script for discovering Pinia or Vuex stores and their actions/state representations.
 *
 * This function is serialized via `.toString()` and evaluated inside the page context,
 * so the types below only exist at the TS boundary — the runtime shapes are whatever
 * Pinia/Vuex put on the Vue app. We use narrow structural types for the fields we touch.
 */

// Minimal structural types describing just the fields we access.
type PiniaStore = Record<string, unknown>;
interface VuexModule {
  _rawModule?: { actions?: Record<string, unknown> };
  state?: Record<string, unknown>;
}
interface VueApp {
  __vue_app__?: {
    config?: {
      globalProperties?: {
        $pinia?: { _s?: Map<string, PiniaStore> };
        $store?: { _modules?: { root?: { _children?: Record<string, VuexModule> } } };
      };
    };
  };
}

export function discoverStores() {
  const stores: Array<{ type: string; id: string; actions: string[]; stateKeys: string[] }> = [];
  try {
    const app = document.querySelector('#app') as unknown as VueApp | null;
    if (!app?.__vue_app__) return stores;
    const gp = app.__vue_app__.config?.globalProperties;

    // Pinia stores
    const pinia = gp?.$pinia;
    if (pinia?._s) {
      pinia._s.forEach((store, id) => {
        const actions: string[] = [];
        const stateKeys: string[] = [];
        for (const k in store) {
          try {
            if (k.startsWith('$') || k.startsWith('_')) continue;
            if (typeof store[k] === 'function') actions.push(k);
            else stateKeys.push(k);
          } catch {}
        }
        stores.push({ type: 'pinia', id, actions: actions.slice(0, 20), stateKeys: stateKeys.slice(0, 15) });
      });
    }

    // Vuex store modules
    const vuex = gp?.$store;
    if (vuex?._modules?.root?._children) {
      const children = vuex._modules.root._children;
      for (const [modName, mod] of Object.entries(children)) {
        const actions = Object.keys(mod._rawModule?.actions ?? {}).slice(0, 20);
        const stateKeys = Object.keys(mod.state ?? {}).slice(0, 15);
        stores.push({ type: 'vuex', id: modName, actions, stateKeys });
      }
    }
  } catch {}
  return stores;
}
