import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgressBar, formatBytes } from './progress.js';

describe('formatBytes', () => {
  it('returns a stable zero-byte label for invalid or sub-byte values', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(0.5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('caps very large values at the largest supported unit', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
  });
});

describe('download progress display', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clamps percentages above 100 to keep the progress bar renderable', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const progress = createProgressBar('file.bin', 0, 1);

    expect(() => progress.update(150, 100)).not.toThrow();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('100%'));
  });

  it('clamps negative percentages to zero', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const progress = createProgressBar('file.bin', 0, 1);

    expect(() => progress.update(-10, 100)).not.toThrow();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('0%'));
  });

  it('renders zero percent when the total size is unknown', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const progress = createProgressBar('file.bin', 0, 1);

    expect(() => progress.update(50, 0)).not.toThrow();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('0%'));
  });
});
