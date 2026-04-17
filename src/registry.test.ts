/**
 * Tests for registry.ts: Strategy enum, cli() registration, helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cli, getRegistry, fullName, strategyLabel, registerCommand, Strategy, type CliCommand } from './registry.js';

describe('cli() registration', () => {
  it('registers a command and returns it', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'hello',
      description: 'A test command',
      strategy: Strategy.PUBLIC,
      browser: false,
    });

    expect(cmd.site).toBe('test-registry');
    expect(cmd.name).toBe('hello');
    expect(cmd.strategy).toBe(Strategy.PUBLIC);
    expect(cmd.browser).toBe(false);
    expect(cmd.args).toEqual([]);
  });

  it('puts registered command in the registry', () => {
    cli({
      site: 'test-registry',
      name: 'registered',
      description: 'test',
    });

    const registry = getRegistry();
    expect(registry.has('test-registry/registered')).toBe(true);
  });

  it('defaults strategy to COOKIE when browser is true', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'default-strategy',
    });

    expect(cmd.strategy).toBe(Strategy.COOKIE);
    expect(cmd.browser).toBe(true);
  });

  it('defaults strategy to PUBLIC when browser is false', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'no-browser',
      browser: false,
    });

    expect(cmd.strategy).toBe(Strategy.PUBLIC);
  });

  it('preserves LOCAL strategy on registration', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'local-strategy',
      description: 'reads local credentials',
      strategy: Strategy.LOCAL,
      browser: false,
    });

    expect(cmd.strategy).toBe(Strategy.LOCAL);
    expect(cmd.browser).toBe(false);
  });

  it('overwrites existing command on re-registration', () => {
    cli({ site: 'test-registry', name: 'overwrite', description: 'v1' });
    cli({ site: 'test-registry', name: 'overwrite', description: 'v2' });

    const reg = getRegistry();
    expect(reg.get('test-registry/overwrite')?.description).toBe('v2');
  });

  it('registers aliases as alternate registry keys for the same command', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'canonical',
      description: 'test aliases',
      aliases: ['compat', 'legacy-name'],
    });

    const registry = getRegistry();
    expect(cmd.aliases).toEqual(['compat', 'legacy-name']);
    expect(registry.get('test-registry/canonical')).toBe(cmd);
    expect(registry.get('test-registry/compat')).toBe(cmd);
    expect(registry.get('test-registry/legacy-name')).toBe(cmd);
  });

  it('preserves defaultFormat on the registered command', () => {
    const cmd = cli({
      site: 'test-registry',
      name: 'plain-default',
      description: 'prefers plain output',
      defaultFormat: 'plain',
    });

    expect(cmd.defaultFormat).toBe('plain');
    expect(getRegistry().get('test-registry/plain-default')?.defaultFormat).toBe('plain');
  });
});

describe('fullName', () => {
  it('returns site/name', () => {
    const cmd: CliCommand = {
      site: 'bilibili', name: 'hot', description: '', args: [],
    };
    expect(fullName(cmd)).toBe('bilibili/hot');
  });
});

describe('strategyLabel', () => {
  it('returns strategy string', () => {
    const cmd: CliCommand = {
      site: 'test', name: 'test', description: '', args: [],
      strategy: Strategy.INTERCEPT,
    };
    expect(strategyLabel(cmd)).toBe('intercept');
  });

  it('returns public when no strategy set', () => {
    const cmd: CliCommand = {
      site: 'test', name: 'test', description: '', args: [],
    };
    expect(strategyLabel(cmd)).toBe('public');
  });
});

describe('registerCommand', () => {
  it('registers a pre-built command', () => {
    const cmd: CliCommand = {
      site: 'test-registry',
      name: 'direct-reg',
      description: 'directly registered',
      args: [],
      strategy: Strategy.HEADER,
      browser: true,
    };
    registerCommand(cmd);

    const reg = getRegistry();
    expect(reg.get('test-registry/direct-reg')?.strategy).toBe(Strategy.HEADER);
  });
});

describe('normalizeCommand (via registerCommand)', () => {
  it('COOKIE + domain → navigateBefore is the domain URL', () => {
    registerCommand({
      site: 'test-norm', name: 'cookie-domain', description: '', args: [],
      strategy: Strategy.COOKIE, domain: 'x.com',
    });
    const cmd = getRegistry().get('test-norm/cookie-domain')!;
    expect(cmd.browser).toBe(true);
    expect(cmd.navigateBefore).toBe('https://x.com');
  });

  it('COOKIE without domain → navigateBefore is true (auth context, no URL)', () => {
    registerCommand({
      site: 'test-norm', name: 'cookie-nodomain', description: '', args: [],
      strategy: Strategy.COOKIE,
    });
    const cmd = getRegistry().get('test-norm/cookie-nodomain')!;
    expect(cmd.browser).toBe(true);
    expect(cmd.navigateBefore).toBe(true);
  });

  it('INTERCEPT → navigateBefore is true (auth context)', () => {
    registerCommand({
      site: 'test-norm', name: 'intercept', description: '', args: [],
      strategy: Strategy.INTERCEPT, domain: 'example.com',
    });
    const cmd = getRegistry().get('test-norm/intercept')!;
    expect(cmd.browser).toBe(true);
    expect(cmd.navigateBefore).toBe(true);
  });

  it('PUBLIC → browser false, navigateBefore undefined', () => {
    registerCommand({
      site: 'test-norm', name: 'public', description: '', args: [],
      strategy: Strategy.PUBLIC,
    });
    const cmd = getRegistry().get('test-norm/public')!;
    expect(cmd.browser).toBe(false);
    expect(cmd.navigateBefore).toBeUndefined();
  });

  it('LOCAL → browser false, navigateBefore undefined', () => {
    registerCommand({
      site: 'test-norm', name: 'local', description: '', args: [],
      strategy: Strategy.LOCAL,
    });
    const cmd = getRegistry().get('test-norm/local')!;
    expect(cmd.strategy).toBe(Strategy.LOCAL);
    expect(strategyLabel(cmd)).toBe('local');
    expect(cmd.browser).toBe(false);
    expect(cmd.navigateBefore).toBeUndefined();
  });

  it('explicit navigateBefore: false overrides COOKIE + domain', () => {
    registerCommand({
      site: 'test-norm', name: 'cookie-override', description: '', args: [],
      strategy: Strategy.COOKIE, domain: 'amazon.com', navigateBefore: false,
    });
    const cmd = getRegistry().get('test-norm/cookie-override')!;
    expect(cmd.browser).toBe(true);
    expect(cmd.navigateBefore).toBe(false);
  });

  it('explicit navigateBefore URL overrides strategy default', () => {
    registerCommand({
      site: 'test-norm', name: 'explicit-url', description: '', args: [],
      strategy: Strategy.COOKIE, domain: 'x.com',
      navigateBefore: 'https://x.com/explore',
    });
    const cmd = getRegistry().get('test-norm/explicit-url')!;
    expect(cmd.navigateBefore).toBe('https://x.com/explore');
  });
});
