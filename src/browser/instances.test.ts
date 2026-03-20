import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  defaultTemporaryUserDataDir,
  inferUserDataKind,
  parsePortList,
  parsePortRange,
  summarizeDebugBrowsers,
  temporaryBrowserLaunchRoot,
} from './instances.js';

describe('debug browser instance helpers', () => {
  it('parses and deduplicates port lists', () => {
    expect(parsePortList('9339, 9222, 9339')).toEqual([9222, 9339]);
  });

  it('rejects invalid port lists', () => {
    expect(() => parsePortList('9222,not-a-port')).toThrow('Invalid ports');
  });

  it('parses custom ranges', () => {
    expect(parsePortRange('9222-9230')).toEqual({ start: 9222, end: 9230 });
  });

  it('rejects inverted ranges', () => {
    expect(() => parsePortRange('9300-9222')).toThrow('Invalid range');
  });

  it('classifies temporary user data directories', () => {
    expect(defaultTemporaryUserDataDir(9339, 'spec')).toBe(path.join(temporaryBrowserLaunchRoot(), 'port-9339-spec'));
    expect(inferUserDataKind(defaultTemporaryUserDataDir(9339, 'spec'))).toBe('temporary');
    expect(inferUserDataKind('/tmp/persistent-profile')).toBe('persistent');
  });

  it('summarizes discovered browsers', () => {
    expect(summarizeDebugBrowsers([
      { port: 9222, endpoint: 'http://127.0.0.1:9222', launchMode: 'unknown', userDataKind: 'unknown', source: 'discovered', status: 'alive' },
      { port: 9339, endpoint: 'http://127.0.0.1:9339', launchMode: 'background', userDataKind: 'temporary', source: 'opencli', status: 'alive' },
      { port: 9444, endpoint: 'http://127.0.0.1:9444', launchMode: 'background', userDataKind: 'persistent', source: 'opencli', status: 'stale' },
    ])).toBe('2 active (9222, 9339), 1 stale');
  });
});
