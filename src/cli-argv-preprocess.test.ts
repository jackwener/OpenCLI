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

  it('hoists a trailing browser --window option to the namespace slot', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'open', 'https://x.com', '--window', 'background'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window',
      'background',
      'open',
      'https://x.com',
    ]);
    expect(rewriteBrowserArgv(['browser', 'work', 'state', '--window', 'foreground'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window',
      'foreground',
      'state',
    ]);
  });

  it('hoists trailing browser --window after leading root options', () => {
    expect(rewriteBrowserArgv(['--profile', 'sandbox', 'browser', 'work', 'state', '--window', 'background'])).toEqual([
      '--profile',
      'sandbox',
      'browser',
      '--session',
      'work',
      '--window',
      'background',
      'state',
    ]);
  });

  it('hoists a trailing browser --window=<mode> option', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'open', 'https://x.com', '--window=background'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window=background',
      'open',
      'https://x.com',
    ]);
  });

  it('hoists browser --window after nested browser leaf commands', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'get', 'url', '--window', 'background'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window',
      'background',
      'get',
      'url',
    ]);
    expect(rewriteBrowserArgv(['browser', 'work', 'tab', 'close', 'abc123', '--window', 'background'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window',
      'background',
      'tab',
      'close',
      'abc123',
    ]);
  });

  it('leaves an already parent-slot browser --window option untouched', () => {
    expect(rewriteBrowserArgv(['browser', 'work', '--window', 'background', 'open', 'https://x.com'])).toEqual([
      'browser',
      '--session',
      'work',
      '--window',
      'background',
      'open',
      'https://x.com',
    ]);
  });

  it('does not hoist browser --window after a literal -- separator', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'eval', 'console.log(1)', '--', '--window', 'background'])).toEqual([
      'browser',
      '--session',
      'work',
      'eval',
      'console.log(1)',
      '--',
      '--window',
      'background',
    ]);
  });

  it('does not hoist a bare trailing browser --window without a value', () => {
    expect(rewriteBrowserArgv(['browser', 'work', 'open', 'https://x.com', '--window'])).toEqual([
      'browser',
      '--session',
      'work',
      'open',
      'https://x.com',
      '--window',
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

import { escapeLeadingDashPositional } from './cli-argv-preprocess.js';

describe('escapeLeadingDashPositional', () => {
  const manifest = [
    { site: 'boss', name: 'detail', browser: true, args: [{ name: 'security-id', positional: true, required: true }, { name: 'retry', positional: false, valueRequired: true }] },
    { site: 'boss', name: 'search', args: [{ name: 'query', positional: true, required: false }, { name: 'limit', positional: false }] },
    { site: 'twitter', name: 'follow', args: [{ name: 'username', positional: true, required: true }] },
    { site: 'twitter', name: 'lists', args: [{ name: 'limit', positional: false }] },
  ];

  it('inserts -- before a required positional starting with `-`', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-abc123def'], manifest))
      .toEqual(['boss', 'detail', '--', '-abc123def']);
  });

  it('preserves trailing flags after the dash-leading positional', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-xyz', '-f', 'json'], manifest))
      .toEqual(['boss', 'detail', '-f', 'json', '--', '-xyz']);
  });

  it('preserves attached short option values like commander does', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-fjson', '-xyz'], manifest))
      .toEqual(['boss', 'detail', '-fjson', '--', '-xyz']);
    expect(escapeLeadingDashPositional(['boss', 'detail', '-xyz', '-fjson'], manifest))
      .toEqual(['boss', 'detail', '-fjson', '--', '-xyz']);
  });

  it('handles known options before a dash-leading positional', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '--format', 'json', '--trace=on', '-xyz'], manifest))
      .toEqual(['boss', 'detail', '--format', 'json', '--trace=on', '--', '-xyz']);
  });

  it('keeps adapter and browser options parseable when they follow the positional', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-xyz', '--retry', '2', '--window', 'foreground'], manifest))
      .toEqual(['boss', 'detail', '--retry', '2', '--window', 'foreground', '--', '-xyz']);
  });

  it('protects negative numeric positionals too', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-42'], manifest))
      .toEqual(['boss', 'detail', '--', '-42']);
  });

  it('leaves unknown dash options untouched instead of hiding them behind --', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '--unknown', 'value'], manifest))
      .toEqual(['boss', 'detail', '--unknown', 'value']);
  });

  it('does not touch positional values that do not start with -', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', 'normal-id'], manifest))
      .toEqual(['boss', 'detail', 'normal-id']);
  });

  it('does not touch the recognised short flags -f / -v / -h', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '-f', 'json'], manifest))
      .toEqual(['boss', 'detail', '-f', 'json']);
    expect(escapeLeadingDashPositional(['boss', 'detail', '-v'], manifest))
      .toEqual(['boss', 'detail', '-v']);
  });

  it('does not touch long flags (--*)', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '--format', 'json'], manifest))
      .toEqual(['boss', 'detail', '--format', 'json']);
  });

  it('does not touch already-escaped --', () => {
    expect(escapeLeadingDashPositional(['boss', 'detail', '--', '-already-escaped'], manifest))
      .toEqual(['boss', 'detail', '--', '-already-escaped']);
  });

  it('does not touch commands without a required positional', () => {
    expect(escapeLeadingDashPositional(['boss', 'search', '-something'], manifest))
      .toEqual(['boss', 'search', '-something']);
    expect(escapeLeadingDashPositional(['twitter', 'lists', '-something'], manifest))
      .toEqual(['twitter', 'lists', '-something']);
  });

  it('works when --profile or another root flag precedes the site', () => {
    expect(escapeLeadingDashPositional(['--profile', 'work', 'boss', 'detail', '-abc'], manifest))
      .toEqual(['--profile', 'work', 'boss', 'detail', '--', '-abc']);
  });

  it('works for any adapter, not just boss', () => {
    expect(escapeLeadingDashPositional(['twitter', 'follow', '-someuser'], manifest))
      .toEqual(['twitter', 'follow', '--', '-someuser']);
  });

  it('returns argv unchanged when the command is unknown', () => {
    expect(escapeLeadingDashPositional(['unknown', 'cmd', '-arg'], manifest))
      .toEqual(['unknown', 'cmd', '-arg']);
  });

  it('returns argv unchanged when argv is too short', () => {
    expect(escapeLeadingDashPositional(['boss'], manifest)).toEqual(['boss']);
    expect(escapeLeadingDashPositional(['boss', 'detail'], manifest)).toEqual(['boss', 'detail']);
  });
});
