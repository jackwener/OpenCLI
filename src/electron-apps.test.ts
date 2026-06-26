import { describe, it, expect } from 'vitest';
import { builtinApps, getElectronApp, isElectronApp, loadApps } from './electron-apps.js';

describe('electron-apps registry', () => {
  it('returns builtin app entry for cursor', () => {
    const app = getElectronApp('cursor');
    expect(app).toBeDefined();
    expect(app!.port).toBe(9226);
    expect(app!.processName).toBe('Cursor');
  });

  it('returns builtin app entry for codex', () => {
    const app = getElectronApp('codex');
    expect(app).toBeDefined();
    expect(app!.port).toBe(9238);
  });

  it('keeps builtin Electron app CDP ports unique and off the browser-bridge port', () => {
    const ports = Object.values(builtinApps).map((app) => app.port);

    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).not.toContain(9222);
  });

  it('returns builtin app entry for Trae CN', () => {
    const app = getElectronApp('trae-cn');
    expect(app).toBeDefined();
    expect(app!.port).toBe(39240);
    expect(app!.processName).toBe('Trae CN');
    expect(app!.bundleId).toBe('cn.trae.app');
    expect(app!.executableNames).toEqual(['Electron']);
  });

  it('returns undefined for non-Electron sites', () => {
    expect(getElectronApp('bilibili')).toBeUndefined();
    expect(getElectronApp('hackernews')).toBeUndefined();
  });

  it('isElectronApp returns true for registered apps', () => {
    expect(isElectronApp('cursor')).toBe(true);
    expect(isElectronApp('codex')).toBe(true);
    expect(isElectronApp('chatwise')).toBe(true);
    expect(isElectronApp('qoder')).toBe(true);
    expect(isElectronApp('trae-solo')).toBe(true);
    expect(isElectronApp('trae-cn')).toBe(true);
  });

  it('registers Qoder on its own CDP port', () => {
    const app = getElectronApp('qoder');
    expect(app).toMatchObject({
      port: 9237,
      processName: 'Qoder',
      bundleId: 'com.qoder.ide',
      displayName: 'Qoder',
    });
  });

  it('registers Trae SOLO with its own CDP port and process metadata', () => {
    const app = getElectronApp('trae-solo');

    expect(app).toBeDefined();
    expect(app!.port).toBe(9235);
    expect(app!.processName).toBe('TRAE SOLO');
    expect(app!.bundleId).toBe('com.trae.solo.app');
  });

  it('isElectronApp returns false for non-Electron sites', () => {
    expect(isElectronApp('bilibili')).toBe(false);
    expect(isElectronApp('notion')).toBe(false);
    expect(isElectronApp('unknown-app')).toBe(false);
  });

  it('loadApps merges user config additively', () => {
    const apps = loadApps({
      myapp: { port: 9234, processName: 'MyApp' },
    });
    expect(apps.myapp).toBeDefined();
    expect(apps.myapp.port).toBe(9234);
    // Builtins still present
    expect(apps.cursor).toBeDefined();
  });

  it('loadApps does not override builtin entries', () => {
    const apps = loadApps({
      cursor: { port: 9999, processName: 'FakeCursor' },
    });
    expect(apps.cursor.port).toBe(9226); // Builtin wins
  });
});
