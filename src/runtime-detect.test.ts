import { describe, it, expect } from 'vitest';
import { detectRuntime, getRuntimeVersion, getRuntimeLabel } from './runtime-detect.js';

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
    const isBun = typeof (globalThis as any).Bun !== 'undefined';
    const rt = detectRuntime();
    if (isBun) {
      expect(rt).toBe('bun');
    } else {
      expect(rt).toBe('node');
    }
  });
});
