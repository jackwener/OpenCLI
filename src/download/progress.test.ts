import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgressBar } from './progress.js';

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
