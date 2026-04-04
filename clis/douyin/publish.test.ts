import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../src/registry.js';
import './publish.js';

describe('douyin publish registration', () => {
  it('registers the publish command', () => {
    const registry = getRegistry();
    const cmds = [...registry.values()];
    const cmd = cmds.find((c) => c.site === 'douyin' && c.name === 'publish');
    expect(cmd).toBeDefined();
    expect(cmd?.args.some((a) => a.name === 'video')).toBe(true);
    expect(cmd?.args.some((a) => a.name === 'title')).toBe(true);
    expect(cmd?.args.some((a) => a.name === 'schedule')).toBe(true);
  });

  it('has all expected args', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(
      (c) => c.site === 'douyin' && c.name === 'publish',
    );
    const argNames = cmd?.args.map((a) => a.name) ?? [];
    expect(argNames).toContain('video');
    expect(argNames).toContain('title');
    expect(argNames).toContain('schedule');
    expect(argNames).toContain('caption');
    expect(argNames).toContain('cover');
    expect(argNames).toContain('visibility');
    expect(argNames).toContain('allow_download');
    expect(argNames).toContain('collection');
    expect(argNames).toContain('activity');
    expect(argNames).toContain('poi_id');
    expect(argNames).toContain('poi_name');
    expect(argNames).toContain('hotspot');
    expect(argNames).toContain('no_safety_check');
    expect(argNames).toContain('sync_toutiao');
  });

  it('uses COOKIE strategy', () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(
      (c) => c.site === 'douyin' && c.name === 'publish',
    );
    expect(cmd?.strategy).toBe('cookie');
  });
});
