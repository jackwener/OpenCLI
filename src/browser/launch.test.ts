import { describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as launch from './launch.js';
import { temporaryBrowserLaunchRoot } from './instances.js';
import { persistentBrowserProfilesRoot } from './profiles.js';

describe('browser launch helpers', () => {
  it('builds a launch plan with a temporary profile by default', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

    const plan = launch.buildLaunchPlan({ port: 9333, url: 'https://example.com', temporaryProfileSeed: 'spec' });

    expect(plan.executable).toContain('Google Chrome');
    expect(plan.endpoint).toBe('http://127.0.0.1:9333');
    expect(plan.userDataDir).toBe(path.join(temporaryBrowserLaunchRoot(), 'port-9333-spec'));
    expect(plan.userDataKind).toBe('temporary');
    expect(plan.args).toContain('--remote-debugging-port=9333');
    expect(plan.args).toContain('--new-window');
    expect(plan.args.at(-1)).toBe('https://example.com');
  });

  it('uses a named profile as a persistent profile', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/tmp/chrome');

    const plan = launch.buildLaunchPlan({ profile: 'zhihu' });

    expect(plan.userDataKind).toBe('persistent');
    expect(plan.profileName).toBe('zhihu');
    expect(plan.userDataDir).toBe(path.join(persistentBrowserProfilesRoot(), 'zhihu'));
  });

  it('adds headless flags when requested', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/tmp/chrome');

    const plan = launch.buildLaunchPlan({ headless: true });

    expect(plan.args).toContain('--headless=new');
    expect(plan.args).toContain('--disable-gpu');
  });

  it('passes through extra browser launch arguments before the target url', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/tmp/chrome');

    const plan = launch.buildLaunchPlan({
      browserArgs: ['--window-size=1440,900', '--lang=en-US'],
      url: 'https://example.com',
    });

    expect(plan.args).toContain('--window-size=1440,900');
    expect(plan.args).toContain('--lang=en-US');
    expect(plan.args.indexOf('--lang=en-US')).toBeLessThan(plan.args.indexOf('https://example.com'));
  });

  it('rejects empty extra browser launch arguments', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/tmp/chrome');

    expect(() => launch.buildLaunchPlan({ browserArgs: ['   '] })).toThrow('Browser launch arguments cannot be empty.');
  });

  it('validates the requested port', () => {
    vi.spyOn(launch, 'resolveBrowserExecutable').mockReturnValue('/tmp/chrome');

    expect(() => launch.buildLaunchPlan({ port: 0 })).toThrow('Invalid CDP port');
  });
});
