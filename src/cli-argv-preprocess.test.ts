import { describe, expect, it } from 'vitest';
import { getBrowserSubcommandNames, rewriteBrowserArgv } from './cli-argv-preprocess.js';

describe('rewriteBrowserArgv', () => {
  it('rewrites `browser <session> <subcommand>` into `browser --session <name> <subcommand>`', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'state'])).toEqual([
      'browser',
      '--session',
      'work',
      'state',
    ]);
  });

  it('rewrites with subcommand arguments preserved', () => {
    expect(rewriteBrowserArgv(['browser', 'mercury', 'open', 'https://x.com'])).toEqual([
      'browser',
      '--session',
      'mercury',
      'open',
      'https://x.com',
    ]);
  });

  it('rewrites `browser <session> bind`', () => {
    expect(rewriteBrowserArgv(['browser', 'mercury', 'bind'])).toEqual([
      'browser',
      '--session',
      'mercury',
      'bind',
    ]);
  });

  it('leaves argv alone when session omitted and a subcommand follows', () => {
    // Commander surfaces the required-flag error itself.
    expect(rewriteBrowserArgv(['browser', 'state'])).toEqual(['browser', 'state']);
    expect(rewriteBrowserArgv(['browser', 'bind'])).toEqual(['browser', 'bind']);
  });

  it('leaves argv alone when the token after `browser` is a flag', () => {
    expect(rewriteBrowserArgv(['browser', '--help'])).toEqual(['browser', '--help']);
    expect(rewriteBrowserArgv(['browser', '-h'])).toEqual(['browser', '-h']);
  });

  it('refuses the retired `opencli browser --session foo ...` user form', () => {
    // The flag form is no longer a public entrance. Tests calling
    // program.parseAsync directly bypass the preprocessor, so internal
    // callers still work; but the user-facing pipeline throws.
    expect(() => rewriteBrowserArgv(['browser', '--session', 'foo', 'state']))
      .toThrowError(/no longer a public option/i);
    expect(() => rewriteBrowserArgv(['browser', '--session=foo', 'state']))
      .toThrowError(/no longer a public option/i);
  });

  it('leaves argv alone when `browser` is not present', () => {
    expect(rewriteBrowserArgv(['twitter', 'tweets', '@elonmusk'])).toEqual([
      'twitter',
      'tweets',
      '@elonmusk',
    ]);
    expect(rewriteBrowserArgv(['doctor'])).toEqual(['doctor']);
  });

  it('returns argv unchanged when `browser` is the last token', () => {
    expect(rewriteBrowserArgv(['browser'])).toEqual(['browser']);
  });

  it('only rewrites when `browser` is the root command, not deeper in argv', () => {
    // `opencli adapter init browser/x` — the literal `browser` is a path argument,
    // not the root command. Must not be touched.
    expect(rewriteBrowserArgv(['adapter', 'init', 'browser', 'x'])).toEqual([
      'adapter',
      'init',
      'browser',
      'x',
    ]);
    // Same for URLs or arbitrary arg values that happen to contain `browser`.
    expect(rewriteBrowserArgv(['twitter', 'tweets', 'https://browser.example.com'])).toEqual([
      'twitter',
      'tweets',
      'https://browser.example.com',
    ]);
    // First-match heuristic must NOT rewrite when an earlier non-flag token
    // already established a different root command.
    expect(rewriteBrowserArgv(['list', 'browser', 'state'])).toEqual([
      'list',
      'browser',
      'state',
    ]);
  });

  it('skips leading root flags before identifying the root command', () => {
    // `--profile` takes a value — the value is not the command.
    expect(rewriteBrowserArgv(['--profile', 'work', 'browser', 'mercury', 'state'])).toEqual([
      '--profile',
      'work',
      'browser',
      '--session',
      'mercury',
      'state',
    ]);
    // Long form with `=` separator consumes one slot only.
    expect(rewriteBrowserArgv(['--profile=work', 'browser', 'mercury', 'state'])).toEqual([
      '--profile=work',
      'browser',
      '--session',
      'mercury',
      'state',
    ]);
    // Boolean flags don't consume values.
    expect(rewriteBrowserArgv(['-v', 'browser', 'mercury', 'state'])).toEqual([
      '-v',
      'browser',
      '--session',
      'mercury',
      'state',
    ]);
  });

  it('leaves argv alone when the root command is not `browser`, even if `browser` appears later', () => {
    // The first browser keyword does NOT win — it must be at the root.
    expect(rewriteBrowserArgv(['twitter', 'browser', 'work', 'state'])).toEqual([
      'twitter',
      'browser',
      'work',
      'state',
    ]);
  });

  it('reserved subcommand list covers every known browser subcommand registered in cli.ts', () => {
    const names = getBrowserSubcommandNames();
    const required = [
      'analyze', 'back', 'bind', 'check', 'click', 'close', 'console', 'dblclick',
      'dialog', 'drag', 'eval', 'extract', 'fill', 'find', 'focus', 'frames',
      'get', 'hover', 'init', 'keys', 'network', 'open', 'screenshot', 'scroll',
      'select', 'state', 'tab', 'type', 'unbind', 'uncheck', 'upload', 'verify',
      'wait',
    ];
    for (const name of required) {
      expect(names.has(name)).toBe(true);
    }
  });
});
