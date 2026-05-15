import { describe, it, expect } from 'vitest';
import { getElectronApp, isElectronApp, loadApps } from './electron-apps.js';

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
    expect(app!.port).toBe(9222);
  });

  it('returns undefined for non-Electron sites', () => {
    expect(getElectronApp('bilibili')).toBeUndefined();
    expect(getElectronApp('hackernews')).toBeUndefined();
  });

  it('isElectronApp returns true for registered apps', () => {
    expect(isElectronApp('cursor')).toBe(true);
    expect(isElectronApp('codex')).toBe(true);
    expect(isElectronApp('chatwise')).toBe(true);
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
