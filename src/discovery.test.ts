import { describe, expect, it } from 'vitest';
import { PLUGIN_MODULE_PATTERN } from './discovery.js';

describe('PLUGIN_MODULE_PATTERN', () => {
  it('matches adapters authored via shared make<Pascal>Command factories', () => {
    // clis/cursor/status.js shape — no direct cli()/lifecycle call.
    expect(PLUGIN_MODULE_PATTERN.test(`export const c = makeStatusCommand('x','y')`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`export const c = makeScreenshotCommand('x', 'y');`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`export const c = makeNewCommand('x', 'y');`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`export const c = makeDumpCommand('x');`)).toBe(true);
  });

  it('still matches direct cli() registrations', () => {
    expect(PLUGIN_MODULE_PATTERN.test(`export const c = cli({ site: 's', name: 'n', access: 'read' });`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`cli (`)).toBe(true);
  });

  it('still matches site-auth and lifecycle hook registrations', () => {
    expect(PLUGIN_MODULE_PATTERN.test(`registerSiteAuthCommands('site', opts)`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`onStartup(async () => {})`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`onBeforeExecute(() => {})`)).toBe(true);
    expect(PLUGIN_MODULE_PATTERN.test(`onAfterExecute(() => {})`)).toBe(true);
  });

  it('does not match helper / type-only modules', () => {
    expect(PLUGIN_MODULE_PATTERN.test(`export function helper() { return 'noop'; }`)).toBe(false);
    // A lowercase factory name must not be treated as a command source.
    expect(PLUGIN_MODULE_PATTERN.test(`export const x = makething();`)).toBe(false);
  });
});
