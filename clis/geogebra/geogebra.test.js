import { describe, expect, it, vi } from 'vitest';
import { ensureApplet, ggbEval, ggbGetProperty, ggbListObjects, ggbWaitForObjectCount } from './utils.js';

function createPageMock(url = 'https://www.geogebra.org/geometry') {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    getCurrentUrl: vi.fn().mockResolvedValue(url),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ensureApplet', () => {
  it('skips navigation when already on the geometry page', async () => {
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate.mockResolvedValue(true);
    await ensureApplet(page);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('navigates when not on the geometry page', async () => {
    const page = createPageMock('https://example.com');
    page.evaluate.mockResolvedValue(true);
    await ensureApplet(page);
    expect(page.goto).toHaveBeenCalledWith('https://www.geogebra.org/geometry');
  });

  it('throws when ggbApplet never becomes available', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(false);
    await expect(ensureApplet(page)).rejects.toThrow('ggbApplet not available');
  });
});

describe('ggbEval', () => {
  it('calls evalCommandGetLabels and evalCommand', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue({ ok: true, label: 'A', beforeCount: 0, afterCount: 1, error: null });
    const result = await ggbEval(page, 'A=(1,2)');
    expect(result).toEqual({ ok: true, label: 'A', beforeCount: 0, afterCount: 1, error: null });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('ggbGetProperty', () => {
  it('requests a property from the applet', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue('point');
    const result = await ggbGetProperty(page, 'A', 'type');
    expect(result).toBe('point');
  });
});

describe('ggbListObjects', () => {
  it('normalizes object rows from the applet', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([
      { name: 'A', type: 'point', value: '(0, 0)', visible: true },
      { name: 't1', type: 'polygon', value: '', visible: true },
    ]);
    const result = await ggbListObjects(page);
    expect(result).toHaveLength(2);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('ggbWaitForObjectCount', () => {
  it('returns the detected object count', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(4);
    const result = await ggbWaitForObjectCount(page, 4);
    expect(result).toBe(4);
  });
});
