/**
 * Tests for plugin manifest: reading, validating, and compatibility checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  _readPluginManifest as readPluginManifest,
  _isMonorepo as isMonorepo,
  _getEnabledPlugins as getEnabledPlugins,
  _parseVersion as parseVersion,
  _satisfiesRange as satisfiesRange,
  MANIFEST_FILENAME,
  type PluginManifest,
} from './plugin-manifest.js';

// ── readPluginManifest ──────────────────────────────────────────────────────

describe('readPluginManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no manifest file exists', () => {
    expect(readPluginManifest(tmpDir)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILENAME), 'not json {{{');
    expect(readPluginManifest(tmpDir)).toBeNull();
  });

  it('returns null for non-object JSON (array)', () => {
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILENAME), '["a","b"]');
    expect(readPluginManifest(tmpDir)).toBeNull();
  });

  it('returns null for non-object JSON (string)', () => {
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILENAME), '"hello"');
    expect(readPluginManifest(tmpDir)).toBeNull();
  });

  it('reads a single-plugin manifest', () => {
    const manifest: PluginManifest = {
      name: 'polymarket',
      version: '1.2.0',
      opencli: '>=1.0.0',
      description: 'Prediction market analysis',
    };
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILENAME), JSON.stringify(manifest));
    const result = readPluginManifest(tmpDir);
    expect(result).toEqual(manifest);
  });

  it('reads a monorepo manifest', () => {
    const manifest: PluginManifest = {
      version: '1.0.0',
      opencli: '>=0.9.0',
      description: 'My plugin collection',
      plugins: {
        polymarket: {
          path: 'packages/polymarket',
          description: 'Prediction market',
          version: '1.2.0',
        },
        defi: {
          path: 'packages/defi',
          description: 'DeFi data',
          version: '0.8.0',
          disabled: true,
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, MANIFEST_FILENAME), JSON.stringify(manifest));
    const result = readPluginManifest(tmpDir);
    expect(result).toEqual(manifest);
    expect(result!.plugins!.polymarket.path).toBe('packages/polymarket');
    expect(result!.plugins!.defi.disabled).toBe(true);
  });
});

// ── isMonorepo ──────────────────────────────────────────────────────────────

describe('isMonorepo', () => {
  it('returns false for single-plugin manifest', () => {
    expect(isMonorepo({ name: 'test', version: '1.0.0' })).toBe(false);
  });

  it('returns false for empty plugins object', () => {
    expect(isMonorepo({ plugins: {} })).toBe(false);
  });

  it('returns true for manifest with plugins', () => {
    expect(
      isMonorepo({
        plugins: {
          foo: { path: 'packages/foo' },
        },
      }),
    ).toBe(true);
  });
});

// ── getEnabledPlugins ───────────────────────────────────────────────────────

describe('getEnabledPlugins', () => {
  it('returns empty array for no plugins', () => {
    expect(getEnabledPlugins({ name: 'test' })).toEqual([]);
  });

  it('filters out disabled plugins', () => {
    const manifest: PluginManifest = {
      plugins: {
        foo: { path: 'packages/foo' },
        bar: { path: 'packages/bar', disabled: true },
        baz: { path: 'packages/baz' },
      },
    };
    const result = getEnabledPlugins(manifest);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual(['baz', 'foo']); // sorted
  });

  it('returns all when none disabled', () => {
    const manifest: PluginManifest = {
      plugins: {
        charlie: { path: 'packages/charlie' },
        alpha: { path: 'packages/alpha' },
      },
    };
    const result = getEnabledPlugins(manifest);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('alpha');
    expect(result[1].name).toBe('charlie');
  });
});

// ── parseVersion ────────────────────────────────────────────────────────────

describe('parseVersion', () => {
  it('parses standard versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.0.0')).toEqual([0, 0, 0]);
    expect(parseVersion('10.20.30')).toEqual([10, 20, 30]);
  });

  it('parses versions with prerelease suffix', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual([1, 2, 3]);
  });

  it('returns null for invalid versions', () => {
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
  });
});

// ── satisfiesRange ──────────────────────────────────────────────────────────

describe('satisfiesRange', () => {
  it('handles >= constraint', () => {
    expect(satisfiesRange('1.4.1', '>=1.0.0')).toBe(true);
    expect(satisfiesRange('1.0.0', '>=1.0.0')).toBe(true);
    expect(satisfiesRange('0.9.9', '>=1.0.0')).toBe(false);
  });

  it('handles <= constraint', () => {
    expect(satisfiesRange('1.0.0', '<=1.0.0')).toBe(true);
    expect(satisfiesRange('0.9.0', '<=1.0.0')).toBe(true);
    expect(satisfiesRange('1.0.1', '<=1.0.0')).toBe(false);
  });

  it('handles > constraint', () => {
    expect(satisfiesRange('1.0.1', '>1.0.0')).toBe(true);
    expect(satisfiesRange('1.0.0', '>1.0.0')).toBe(false);
  });

  it('handles < constraint', () => {
    expect(satisfiesRange('0.9.9', '<1.0.0')).toBe(true);
    expect(satisfiesRange('1.0.0', '<1.0.0')).toBe(false);
  });

  it('handles ^ (caret) constraint', () => {
    expect(satisfiesRange('1.2.0', '^1.2.0')).toBe(true);
    expect(satisfiesRange('1.9.9', '^1.2.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesRange('1.1.0', '^1.2.0')).toBe(false);
  });

  it('handles ~ (tilde) constraint', () => {
    expect(satisfiesRange('1.2.0', '~1.2.0')).toBe(true);
    expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
  });

  it('handles exact match', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('handles compound range (AND)', () => {
    expect(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfiesRange('0.9.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('returns true for empty range', () => {
    expect(satisfiesRange('1.0.0', '')).toBe(true);
    expect(satisfiesRange('1.0.0', '  ')).toBe(true);
  });

  it('returns true for unparseable version', () => {
    expect(satisfiesRange('dev', '>=1.0.0')).toBe(true);
  });
});
