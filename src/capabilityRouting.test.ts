import { describe, expect, it } from 'vitest';
import { Strategy, type CliCommand } from './registry.js';
import { BROWSER_ONLY_STEPS, _validateBrowserOnlyStepsAgainstRegistry, shouldUseBrowserSession } from './capabilityRouting.js';
import { getRegisteredStepNames } from './pipeline/registry.js';

function makeCmd(partial: Partial<CliCommand>): CliCommand {
  return {
    site: 'test',
    name: 'command', access: 'read',
    description: '',
    args: [],
    ...partial,
  } as CliCommand;
}

describe('shouldUseBrowserSession', () => {
  it('skips browser session for public fetch-only pipelines', () => {
    expect(shouldUseBrowserSession(makeCmd({
      browser: true,
      strategy: Strategy.PUBLIC,
      pipeline: [{ fetch: 'https://example.com/api' }, { select: 'items' }],
    }))).toBe(false);
  });

  it('keeps browser session for public pipelines with browser-only steps', () => {
    expect(shouldUseBrowserSession(makeCmd({
      browser: true,
      strategy: Strategy.PUBLIC,
      pipeline: [{ navigate: 'https://example.com' }, { evaluate: '() => []' }],
    }))).toBe(true);
  });

  it('keeps browser session for non-public strategies (via normalized navigateBefore)', () => {
    // After normalizeCommand, COOKIE strategy without domain sets navigateBefore: true
    // (signals "needs authenticated browser context" without a specific pre-nav URL).
    expect(shouldUseBrowserSession(makeCmd({
      browser: true,
      strategy: Strategy.COOKIE,
      navigateBefore: true,
      pipeline: [{ fetch: 'https://example.com/api' }],
    }))).toBe(true);
  });

  it('keeps browser session for function adapters', () => {
    expect(shouldUseBrowserSession(makeCmd({
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [],
    }))).toBe(true);
  });

  it('routes pipelines containing the fill step into a browser session', () => {
    expect(shouldUseBrowserSession(makeCmd({
      browser: true,
      strategy: Strategy.PUBLIC,
      pipeline: [{ navigate: 'https://example.com' }, { fill: { ref: '#q', text: 'hello' } }],
    }))).toBe(true);
  });
});

describe('BROWSER_ONLY_STEPS / pipeline registry alignment', () => {
  it('is a subset of registered pipeline step names', () => {
    const { extras } = _validateBrowserOnlyStepsAgainstRegistry();
    expect(extras).toEqual([]);
  });

  it('includes fill (DOM-touching step added in PR #1222)', () => {
    expect(BROWSER_ONLY_STEPS.has('fill')).toBe(true);
    expect(getRegisteredStepNames()).toContain('fill');
  });
});
