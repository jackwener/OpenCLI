import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import {
  getConfigPath,
  getConfigValue,
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

  it('uses ~/.opencli/config.json', () => {
    expect(getConfigPath()).toBe(path.join(homeDir, '.opencli', 'config.json'));
  });

  it('returns the default daemon port when config is missing or malformed', () => {
    expect(loadConfig()).toEqual({ version: 1 });
    expect(getConfiguredDaemonPort()).toBe(DEFAULT_DAEMON_PORT);

    fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
    fs.writeFileSync(getConfigPath(), '{ nope', 'utf-8');

    expect(loadConfig()).toEqual({ version: 1 });
    expect(getConfigValue('daemon.port')).toBe(DEFAULT_DAEMON_PORT);
  });

  it('sets and unsets daemon.port atomically', () => {
    setConfigValue('daemon.port', '23456');

    expect(loadConfig()).toEqual({ version: 1, daemon: { port: 23456 } });
    expect(getConfiguredDaemonPort()).toBe(23456);

    unsetConfigValue('daemon.port');

    expect(loadConfig()).toEqual({ version: 1 });
    expect(getConfiguredDaemonPort()).toBe(DEFAULT_DAEMON_PORT);
  });

  it('rejects invalid daemon ports', () => {
    expect(() => setConfigValue('daemon.port', '0')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', '65536')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', '123.5')).toThrow(/between 1 and 65535/);
    expect(() => setConfigValue('daemon.port', 'abc')).toThrow(/between 1 and 65535/);
  });
});
