import { describe, expect, it } from 'vitest';

import { buildDaemonEndpoints, normalizeDaemonHost } from './protocol';

describe('daemon host normalization', () => {
  it('strips legacy schemes and ports from stored daemon hosts', () => {
    expect(normalizeDaemonHost('http://1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeDaemonHost('example.com:19825')).toBe('example.com');
    expect(normalizeDaemonHost('[::1]:19825')).toBe('::1');
  });

  it('builds valid daemon endpoints from normalized hosts', () => {
    expect(buildDaemonEndpoints('http://1.2.3.4', 19825)).toEqual({
      ping: 'http://1.2.3.4:19825/ping',
      ws: 'ws://1.2.3.4:19825/ext',
    });
    expect(buildDaemonEndpoints('[::1]:19825', 19825)).toEqual({
      ping: 'http://[::1]:19825/ping',
      ws: 'ws://[::1]:19825/ext',
    });
  });
});
