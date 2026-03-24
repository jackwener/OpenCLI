/**
 * Tests for pipeline/steps/intercept.ts.
 */

import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../errors.js';
import { stepIntercept } from './intercept.js';
import type { IPage } from '../../types.js';

/** Create a minimal browser page mock for intercept step tests. */
function createMockPage(overrides: Partial<IPage> = {}): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(null),
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(''),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn(),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue(''),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

describe('stepIntercept', () => {
  it('throws ConfigError when browser session is missing', async () => {
    await expect(stepIntercept(null, { capture: '/api/posts' }, null, {})).rejects.toBeInstanceOf(ConfigError);
    await expect(stepIntercept(null, { capture: '/api/posts' }, null, {})).rejects.toThrow(
      'intercept step requires a browser session',
    );
  });

  it('waits for the configured timeout without truncating it to 3 seconds', async () => {
    const page = createMockPage({
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce([{ id: 1 }]),
      wait: vi.fn(),
    });

    const result = await stepIntercept(page, { capture: '/api/posts', timeout: 12 }, null, {});

    expect(result).toEqual({ id: 1 });
    expect(page.wait).toHaveBeenCalledWith(12);
  });
});
