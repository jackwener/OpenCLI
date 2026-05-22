import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { ensureApplet, ggbEval, ggbGetProperty, ggbListObjects, ggbWaitForObjectCount } from './utils.js';
import './add-circle.js';
import './add-line.js';
import './add-point.js';
import './add-polygon.js';
import './eval.js';
import './hexagon.js';
import './info.js';
import './list.js';
import './triangle.js';

function createPageMock(url = 'https://www.geogebra.org/geometry') {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    getCurrentUrl: vi.fn().mockResolvedValue(url),
    wait: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ensureApplet', () => {
  it('skips navigation when already on the geometry page', async () => {
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate.mockResolvedValue(true);
    await ensureApplet(page);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('unwraps Browser Bridge evaluate envelopes while checking applet readiness', async () => {
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate.mockResolvedValue({ session: 1, data: true });
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
    await expect(ensureApplet(page)).rejects.toThrow(CommandExecutionError);
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

  it('throws typed errors for malformed evaluate results', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue({ nope: true });
    await expect(ggbEval(page, 'A=(1,2)')).rejects.toThrow(CommandExecutionError);
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

  it('unwraps Browser Bridge envelopes for object rows', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue({ session: 1, data: [{ name: 'A', type: 'point', value: '(0, 0)', visible: true }] });
    const result = await ggbListObjects(page);
    expect(result).toEqual([{ name: 'A', type: 'point', value: '(0, 0)', visible: true }]);
  });

  it('throws typed error when object names exist but property extraction fails', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue({ error: 'getObjectType failed', name: 'A' });
    await expect(ggbListObjects(page)).rejects.toThrow(CommandExecutionError);
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

describe('geogebra command typed boundaries', () => {
  it('validates add-point args before navigating', async () => {
    const command = getRegistry().get('geogebra/add-point');
    const page = createPageMock('https://example.com');
    await expect(command.func(page, { name: 'A', coords: 'bad' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('validates triangle size before navigating instead of silently defaulting', async () => {
    const command = getRegistry().get('geogebra/triangle');
    const page = createPageMock('https://example.com');
    await expect(command.func(page, { size: 'not-a-number' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('fails eval command execution instead of returning a success row for failed commands', async () => {
    const command = getRegistry().get('geogebra/eval');
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ok: false, label: '', beforeCount: 0, afterCount: 0, error: 'Unknown command' });
    await expect(command.func(page, { command: 'NotACommand(' })).rejects.toThrow(CommandExecutionError);
  });

  it('creates add-line rows from validated labels', async () => {
    const command = getRegistry().get('geogebra/add-line');
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ok: true, label: 'f', beforeCount: 2, afterCount: 3, error: null });
    await expect(command.func(page, { points: 'A,B', type: 'segment' })).resolves.toEqual([
      { label: 'f', type: 'segment', points: 'A,B' },
    ]);
  });

  it('does not turn object property extraction failures into empty list results', async () => {
    const command = getRegistry().get('geogebra/list');
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ error: 'getObjectType failed', name: 'A' });
    await expect(command.func(page, {})).rejects.toThrow(CommandExecutionError);
  });

  it('does not turn malformed info existence probes into not-found results', async () => {
    const command = getRegistry().get('geogebra/info');
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ nope: true });
    await expect(command.func(page, { name: 'A' })).rejects.toThrow(CommandExecutionError);
  });

  it('maps explicit false info existence probes to EmptyResultError', async () => {
    const command = getRegistry().get('geogebra/info');
    const page = createPageMock('https://www.geogebra.org/geometry');
    page.evaluate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ok: true, exists: false });
    await expect(command.func(page, { name: 'A' })).rejects.toThrow(EmptyResultError);
  });
});
