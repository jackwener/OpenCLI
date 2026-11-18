import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { executePipeline } from '../index.js';
import { stepTap } from './tap.js';

type PageWindow = { fetch: (url: string) => Promise<unknown> };

/**
 * A page whose evaluate() runs the generated tap IIFE against a minimal
 * Pinia-style app. `makeStores` gets the page window, so a store action can
 * issue a request through the (patched) window.fetch; every request answers
 * with `response`. `null` stores means the page has no Vue app at all.
 */
function fakePage(
  makeStores: ((win: PageWindow) => Record<string, Record<string, unknown>>) | null,
  response: unknown = null,
): IPage {
  const win: Record<string, unknown> = {
    setTimeout,
    Request: class {},
    XMLHttpRequest: class {
      open() {}
      send() {}
    },
    fetch: async () => ({ clone: () => ({ json: async () => response }) }),
  };
  win.window = win;
  const stores = makeStores?.(win as unknown as PageWindow);
  const app = stores
    ? { __vue_app__: { config: { globalProperties: { $pinia: { _s: new Map(Object.entries(stores)) } } } } }
    : null;
  win.document = { querySelector: (selector: string) => (selector === '#app' ? app : null) };
  const context = vm.createContext(win);
  return { evaluate: async (js: string) => vm.runInContext(`(${js})()`, context) } as unknown as IPage;
}

describe('stepTap', () => {
  it('returns the captured response, narrowed by select', async () => {
    const page = fakePage(
      (win) => ({ notification: { load: () => win.fetch('https://example.com/api/you/mentions') } }),
      { data: { message_list: [{ id: 1 }, { id: 2 }] } },
    );
    await expect(stepTap(page, {
      store: 'notification', action: 'load', capture: '/you/', select: 'data.message_list', timeout: 1,
    }, null, {})).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('fails when the store does not exist instead of returning an error object as data', async () => {
    const page = fakePage(null);
    const error = await stepTap(page, { store: 'notification', action: 'load', capture: '/you/', timeout: 0.01 }, null, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('Store not found: notification');
    expect((error as CliError).hint).toContain('store name');
  });

  it('fails when the action does not exist on the store', async () => {
    const page = fakePage(() => ({ notification: { other: () => undefined } }));
    const error = await stepTap(page, { store: 'notification', action: 'load', capture: '/you/', timeout: 0.01 }, null, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('Action not found: load on store notification');
    expect((error as CliError).hint).toContain('other');
  });

  it('fails when no matching response is captured', async () => {
    const page = fakePage(() => ({ notification: { load: () => undefined } }));
    const error = await stepTap(page, { store: 'notification', action: 'load', capture: '/you/', timeout: 0.01 }, null, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('No matching response captured for pattern: /you/');
  });

  it('passes through a captured response that has its own error field', async () => {
    const page = fakePage(
      (win) => ({ notification: { load: () => win.fetch('https://example.com/api/you/mentions') } }),
      { error: 'rate limited' },
    );
    await expect(stepTap(page, { store: 'notification', action: 'load', capture: '/you/', timeout: 1 }, null, {}))
      .resolves.toEqual({ error: 'rate limited' });
  });

  it('does not turn a tap failure into a one-row pipeline result', async () => {
    const page = fakePage(null);
    await expect(executePipeline(page, [
      { tap: { store: 'notification', action: 'load', capture: '/you/', timeout: 0.01 } },
      { map: { rank: '${{ index + 1 }}', user: '${{ item.user_info.nickname }}' } },
    ])).rejects.toBeInstanceOf(CliError);
  });
});
