import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getUserAppsConfigPath,
  getUserCliDir,
  getUserExploreDir,
  getUserExternalClisConfigPath,
  getUserOpenCliPath,
  getUserPluginLockFilePath,
  getUserRecordDir,
  getUserUpdateCheckCachePath,
  USER_CLIS_DIR,
  USER_EXPLORE_DIR,
  USER_OPENCLI_DIR,
  USER_PLUGINS_DIR,
  USER_RECORD_DIR,
} from './user-opencli-paths.js';

describe('user-opencli-paths', () => {
  it('builds the shared user runtime root under ~/.opencli', () => {
    expect(getUserOpenCliPath()).toBe(USER_OPENCLI_DIR);
    expect(USER_CLIS_DIR).toBe(path.join(USER_OPENCLI_DIR, 'clis'));
    expect(USER_PLUGINS_DIR).toBe(path.join(USER_OPENCLI_DIR, 'plugins'));
  });

  it('builds the shared explore directory under ~/.opencli', () => {
    expect(USER_EXPLORE_DIR).toBe(path.join(USER_OPENCLI_DIR, 'explore'));
    expect(getUserExploreDir('mysite')).toBe(path.join(USER_OPENCLI_DIR, 'explore', 'mysite'));
  });

  it('builds the shared record directory under ~/.opencli', () => {
    expect(USER_RECORD_DIR).toBe(path.join(USER_OPENCLI_DIR, 'record'));
    expect(getUserRecordDir('mysite')).toBe(path.join(USER_OPENCLI_DIR, 'record', 'mysite'));
  });

  it('builds shared config and cache files under ~/.opencli', () => {
    expect(getUserCliDir('mysite')).toBe(path.join(USER_OPENCLI_DIR, 'clis', 'mysite'));
    expect(getUserAppsConfigPath()).toBe(path.join(USER_OPENCLI_DIR, 'apps.yaml'));
    expect(getUserExternalClisConfigPath()).toBe(path.join(USER_OPENCLI_DIR, 'external-clis.yaml'));
    expect(getUserPluginLockFilePath()).toBe(path.join(USER_OPENCLI_DIR, 'plugins.lock.json'));
    expect(getUserUpdateCheckCachePath()).toBe(path.join(USER_OPENCLI_DIR, 'update-check.json'));
  });
});
