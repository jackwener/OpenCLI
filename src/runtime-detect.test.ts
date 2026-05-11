import { describe, it, expect } from 'vitest';
import { detectRuntime, getRuntimeVersion, getRuntimeLabel, parseNodeMajor, isSupportedNodeVersion, MIN_SUPPORTED_NODE_MAJOR } from './runtime-detect.js';

describe('runtime-detect', () => {
  it('detectRuntime returns a valid runtime string', () => {
    const rt = detectRuntime();
    expect(['bun', 'node']).toContain(rt);
  });

  it('getRuntimeVersion returns a non-empty version string', () => {
    const ver = getRuntimeVersion();
    expect(typeof ver).toBe('string');
    expect(ver.length).toBeGreaterThan(0);
  });

  it('getRuntimeLabel returns "<runtime> <version>" format', () => {
    const label = getRuntimeLabel();
    expect(label).toMatch(/^(bun|node) .+$/);
  });

  it('detects the current environment correctly', () => {
    const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
    const rt = detectRuntime();
    if (isBun) {
      expect(rt).toBe('bun');
    } else {
      expect(rt).toBe('node');
    }
  });

  it('parses Node major versions from standard version strings', () => {
    expect(parseNodeMajor('v21.0.0')).toBe(21);
    expect(parseNodeMajor('22.13.1')).toBe(22);
    expect(parseNodeMajor('bun-1.2.0')).toBeNull();
  });

  it('checks the current minimum supported Node major version', () => {
    expect(MIN_SUPPORTED_NODE_MAJOR).toBe(21);
    expect(isSupportedNodeVersion('v20.18.0')).toBe(false);
    expect(isSupportedNodeVersion('v21.0.0')).toBe(true);
    expect(isSupportedNodeVersion('v25.0.0')).toBe(true);
  });
});
