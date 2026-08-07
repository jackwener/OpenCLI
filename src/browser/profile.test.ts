import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { profileRouteParams, resolveProfileSelection } from './profile.js';

describe('profile selection (requirement vs preference)', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-profile-test-'));
    vi.stubEnv('OPENCLI_CONFIG_DIR', configDir);
    vi.stubEnv('OPENCLI_PROFILE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function writeConfig(config: object): void {
    fs.writeFileSync(path.join(configDir, 'browser-profiles.json'), JSON.stringify(config));
  }

  it('tags an explicit --profile argument as explicit and resolves aliases', () => {
    writeConfig({ version: 1, aliases: { work: 'zvypsyje' } });
    expect(resolveProfileSelection('work')).toEqual({ contextId: 'zvypsyje', source: 'explicit' });
  });

  it('tags OPENCLI_PROFILE env as explicit', () => {
    vi.stubEnv('OPENCLI_PROFILE', 'pavmrekj');
    expect(resolveProfileSelection()).toEqual({ contextId: 'pavmrekj', source: 'explicit' });
  });

  it('tags the persisted config default as preferred, not explicit', () => {
    writeConfig({ version: 1, aliases: {}, defaultContextId: 'zvypsyje' });
    expect(resolveProfileSelection()).toEqual({ contextId: 'zvypsyje', source: 'preferred' });
  });

  it('explicit argument beats env beats config default', () => {
    vi.stubEnv('OPENCLI_PROFILE', 'from-env');
    writeConfig({ version: 1, aliases: {}, defaultContextId: 'from-config' });
    expect(resolveProfileSelection('from-arg')).toEqual({ contextId: 'from-arg', source: 'explicit' });
    expect(resolveProfileSelection()).toEqual({ contextId: 'from-env', source: 'explicit' });
  });

  it('returns undefined with no argument, env, or config default', () => {
    expect(resolveProfileSelection()).toBeUndefined();
  });

  it('profileRouteParams maps explicit → contextId and preferred → preferredContextId', () => {
    expect(profileRouteParams({ contextId: 'a', source: 'explicit' })).toEqual({ contextId: 'a' });
    expect(profileRouteParams({ contextId: 'b', source: 'preferred' })).toEqual({ preferredContextId: 'b' });
    expect(profileRouteParams(undefined)).toEqual({});
  });
});
