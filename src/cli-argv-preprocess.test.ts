import { describe, expect, it } from 'vitest';
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
