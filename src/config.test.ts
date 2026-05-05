import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import {
  getConfigPath,
  getConfigValue,
  getConfiguredBrowserCommandTimeout,
  getConfiguredBrowserConnectTimeout,
  getConfiguredCdpEndpoint,
  getConfiguredDaemonPort,
  loadConfig,
  setConfigValue,
  unsetConfigValue,
} from './config.js';

describe('opencli config', () => {
  let homeDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-config-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('uses ~/.opencli/config.yaml', () => {
    expect(getConfigPath()).toBe(path.join(homeDir, '.opencli', 'config.yaml'));
  });

  it('returns the default daemon port when config is missing or malformed', () => {
    expect(loadConfig()).toEqual({});
    expect(getConfiguredDaemonPort()).toBe(DEFAULT_DAEMON_PORT);

    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), '{ nope', 'utf-8');

    expect(loadConfig()).toEqual({});
    expect(getConfigValue('daemon.port')).toBe(DEFAULT_DAEMON_PORT);
  });

  it('sets and unsets daemon.port atomically', () => {
    setConfigValue('daemon.port', '23456');

    expect(loadConfig()).toEqual({ daemon: { port: 23456 } });
    expect(getConfiguredDaemonPort()).toBe(23456);

    unsetConfigValue('daemon.port');

    expect(loadConfig()).toEqual({});
    expect(getConfiguredDaemonPort()).toBe(DEFAULT_DAEMON_PORT);
  });

  it('sets and unsets browser config values', () => {
    setConfigValue('browser.connect_timeout', '45');
    setConfigValue('browser.command_timeout', '90');
    setConfigValue('browser.cdp_endpoint', '  http://127.0.0.1:9222  ');

    expect(loadConfig()).toEqual({
      browser: {
        connect_timeout: 45,
        command_timeout: 90,
        cdp_endpoint: 'http://127.0.0.1:9222',
      },
    });
    expect(getConfiguredBrowserConnectTimeout()).toBe(45);
    expect(getConfiguredBrowserCommandTimeout()).toBe(90);
    expect(getConfiguredCdpEndpoint()).toBe('http://127.0.0.1:9222');

    unsetConfigValue('browser.connect_timeout');
    unsetConfigValue('browser.command_timeout');
    unsetConfigValue('browser.cdp_endpoint');

    expect(loadConfig()).toEqual({});
    expect(getConfiguredBrowserConnectTimeout()).toBe(30);
    expect(getConfiguredBrowserCommandTimeout()).toBe(60);
    expect(getConfiguredCdpEndpoint()).toBeUndefined();
  });

  it('parses quoted YAML strings without treating URL fragments as comments', () => {
    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), [
      'browser:',
      '  connect_timeout: 31',
      '  command_timeout: 62',
      '  cdp_endpoint: "http://x.example/path?q=1#frag"',
      '',
    ].join('\n'), 'utf-8');

    expect(loadConfig()).toEqual({
      browser: {
        connect_timeout: 31,
        command_timeout: 62,
        cdp_endpoint: 'http://x.example/path?q=1#frag',
      },
    });
  });

  it('rejects invalid daemon ports', () => {
    expect(() => setConfigValue('daemon.port', '0')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', '65536')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', '123.5')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', 'abc')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('browser.connect_timeout', '0')).toThrow(/positive integer/);
    expect(() => setConfigValue('browser.command_timeout', '1.5')).toThrow(/positive integer/);
    expect(() => setConfigValue('browser.cdp_endpoint', '')).toThrow(/non-empty string/);
  });
});
