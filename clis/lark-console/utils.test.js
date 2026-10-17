import { describe, expect, it } from 'vitest';
import { normalizeAppId, fmtUnix, truncate, joinList, roleLabel, isOnlineVersion, splitScopes } from './utils.js';

describe('lark-console utils', () => {
  it('extracts app ids from bare ids, paths and console urls', () => {
    expect(normalizeAppId('cli_aab2033f0b389ee7')).toBe('cli_aab2033f0b389ee7');
    expect(normalizeAppId('/app/cli_aab2033f0b389ee7/baseinfo')).toBe('cli_aab2033f0b389ee7');
    expect(normalizeAppId('https://open.larksuite.com/app/cli_aab2033f0b389ee7/auth')).toBe('cli_aab2033f0b389ee7');
    expect(normalizeAppId(null)).toBe('');
    expect(normalizeAppId('   spaced   ')).toBe('spaced');
  });

  it('renders unix seconds as a stable UTC stamp', () => {
    expect(fmtUnix(1782109454)).toBe('2026-06-22 06:24 UTC');
    expect(fmtUnix(0)).toBe('');
    expect(fmtUnix(null)).toBe('');
    expect(fmtUnix('not-a-number')).toBe('');
  });

  it('truncates and collapses whitespace', () => {
    expect(truncate('  hello   world  ')).toBe('hello world');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate(null)).toBe('');
    expect(truncate('keep', 0)).toBe('keep');
  });

  it('joins ability/lang lists, ignoring non-arrays', () => {
    expect(joinList(['bot', 'web_app'])).toBe('bot,web_app');
    expect(joinList(['en_us', '', 'zh_cn'])).toBe('en_us,zh_cn');
    expect(joinList(null)).toBe('');
    expect(joinList('bot')).toBe('');
  });

  it('labels owner vs collaborator from the role code', () => {
    expect(roleLabel(1)).toBe('owner');
    expect(roleLabel(2)).toBe('collaborator');
    expect(roleLabel(undefined)).toBe('collaborator');
  });

  it('flags only the live (status 2) version as online', () => {
    expect(isOnlineVersion(2)).toBe(true);
    expect(isOnlineVersion(100)).toBe(false);
    expect(isOnlineVersion(undefined)).toBe(false);
  });

  it('splits scope inputs on commas and whitespace', () => {
    expect(splitScopes('im:message, contact:contact.base:readonly')).toEqual(['im:message', 'contact:contact.base:readonly']);
    expect(splitScopes('8002  20001')).toEqual(['8002', '20001']);
    expect(splitScopes('im:message')).toEqual(['im:message']);
    expect(splitScopes('')).toEqual([]);
    expect(splitScopes(null)).toEqual([]);
  });
});
