/**
 * Tests for pipeline/steps/tap.ts.
 */

import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../errors.js';
import { stepTap } from './tap.js';

describe('stepTap', () => {
  it('throws ConfigError when browser session is missing', async () => {
    await expect(stepTap(null, { store: 'feed', action: 'load' }, null, {})).rejects.toBeInstanceOf(ConfigError);
    await expect(stepTap(null, { store: 'feed', action: 'load' }, null, {})).rejects.toThrow(
      'tap step requires a browser session',
    );
  });
});
