import { describe, expect, it } from 'vitest';
import { shouldLaunchChrome } from './daemon-lifecycle.js';

describe('shouldLaunchChrome', () => {
  it('is false in CI even if stdio looks interactive', () => {
    expect(shouldLaunchChrome({ CI: 'true' })).toBe(false);
    expect(shouldLaunchChrome({ CONTINUOUS_INTEGRATION: '1' })).toBe(false);
    expect(shouldLaunchChrome({ OPENCLI_NO_LAUNCH_CHROME: '1' })).toBe(false);
  });
});
