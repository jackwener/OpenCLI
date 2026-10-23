import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeIdlePlaceholder, findIdleInteractiveGroup, idlePlaceholderUrl, parkIdleInteractiveTab } from './idle-container';
const KEY = 'opencli_idle_interactive_v1';
const token = '00000000-0000-4000-8000-000000000001';
const marker = `chrome-extension://opencli/idle.html#${token}`;
let storage: Record<string, unknown>;
let tabs: any[];
let window: any;
let chromeMock: any;
beforeEach(() => {
  storage = { [KEY]: token };
  tabs = [{ id: 70, windowId: 7, groupId: 400, url: marker }];
  window = { id: 7, type: 'normal', incognito: false };
  chromeMock = {
    runtime: { getURL: (path: string) => `chrome-extension://opencli/${path}` },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (items: any) => Object.assign(storage, items)),
      remove: vi.fn(async (key: string) => { delete storage[key]; }),
    } },
    tabs: { query: vi.fn(async ({ windowId }: any) => tabs.filter(t => windowId === undefined || t.windowId === windowId)) },
    windows: { get: vi.fn(async () => window) },
    tabGroups: { TAB_GROUP_ID_NONE: -1, get: vi.fn(async () => ({ id: 400, windowId: 7, title: 'Renamed', color: 'blue' })) },
  };
  vi.stubGlobal('chrome', chromeMock);
});
afterEach(() => vi.unstubAllGlobals());
describe('idle container ownership', () => {
  it('recovers a sole marked idle tab without relying on appearance', async () => {
    await expect(findIdleInteractiveGroup(new Set())).resolves.toMatchObject({ id: 400, windowId: 7 });
  });
  it.each(['https://user.example/form', 'about:blank', 'chrome-extension://other/idle.html#'+token, marker+'old'])('does not claim unmarked or stale tabs: %s', async url => {
    tabs[0].url = url;
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('does not infer ownership when local evidence was cleared', async () => {
    storage = {};
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('rejects duplicate markers instead of picking the lowest window id', async () => {
    tabs.push({ ...tabs[0], id: 80, windowId: 8 });
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('leaves personal tabs in a mixed window untouched', async () => {
    tabs.push({ id: 71, windowId: 7, groupId: 400, url: 'https://user.example' });
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('does not adopt a tab reserved by any lease, including bound leases', async () => {
    await expect(findIdleInteractiveGroup(new Set([70]))).resolves.toBeNull();
  });
  it.each([{ incognito: true }, { type: 'popup' }])('rejects unsupported windows: %j', async patch => {
    Object.assign(window, patch);
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('does not adopt a marker navigating to user content', async () => {
    tabs[0].pendingUrl = 'https://user.example';
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
    await expect(consumeIdlePlaceholder(tabs[0])).rejects.toThrow('being navigated');
    expect(storage[KEY]).toBe(token);
  });
  it('rechecks window membership before adopting', async () => {
    chromeMock.tabs.query.mockResolvedValueOnce([...tabs]).mockResolvedValueOnce([...tabs, { id: 71, windowId: 7 }]);
    await expect(findIdleInteractiveGroup(new Set())).resolves.toBeNull();
  });
  it('rotates the marker and consumes it before reuse', async () => {
    const url = await parkIdleInteractiveTab(70, 7);
    expect(url).toMatch(/^chrome-extension:\/\/opencli\/idle.html#[a-f0-9-]{36}$/);
    expect(url).not.toBe(marker);
    await consumeIdlePlaceholder({ ...tabs[0], url });
    await expect(idlePlaceholderUrl()).resolves.toBeNull();
  });
  it('does not mint a recovery marker for mixed windows', async () => {
    tabs.push({ id: 71, windowId: 7 });
    await expect(parkIdleInteractiveTab(70, 7)).resolves.toBeNull();
    expect(chromeMock.storage.local.set).not.toHaveBeenCalled();
  });
  it('propagates storage failures instead of inventing ownership', async () => {
    chromeMock.storage.local.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(findIdleInteractiveGroup(new Set())).rejects.toThrow('storage unavailable');
  });
});
