import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeBrowserTabPlacement, resolveBrowserTabPlacementFromEnv } from './tab-placement.js';

describe('browser tab placement', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to owned-container when OPENCLI_TAB_PLACEMENT is unset', () => {
    vi.stubEnv('OPENCLI_TAB_PLACEMENT', '');

    expect(resolveBrowserTabPlacementFromEnv()).toBe('owned-container');
  });

  it('allows callers to opt into existing-window placement', () => {
    vi.stubEnv('OPENCLI_TAB_PLACEMENT', 'existing-window');

    expect(resolveBrowserTabPlacementFromEnv()).toBe('existing-window');
  });

  it('rejects unsupported placement values', () => {
    expect(() => normalizeBrowserTabPlacement('OPENCLI_TAB_PLACEMENT', 'new-window'))
      .toThrow('owned-container, existing-window');
  });
});
