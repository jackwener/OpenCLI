import { describe, expect, it, vi } from 'vitest';
import { buildEvaluateExpression, wrapForEval, gotoResilient } from './utils.js';

describe('browser eval utils', () => {
  it('keeps existing string eval wrapping behavior', () => {
    expect(wrapForEval('21 + 21')).toBe('21 + 21');
    expect(wrapForEval('() => 42')).toBe('(() => 42)()');
  });

  it('serializes function eval arguments as JSON', () => {
    const code = buildEvaluateExpression((selector: string) => {
      return document.querySelector(selector)?.textContent ?? null;
    }, ['.title']);

    expect(code).toContain('document.querySelector(selector)');
    expect(code).toContain('(...[".title"])');
  });

  it('accepts compact async arrow functions', () => {
    const fn = new Function('return async()=>42')() as () => Promise<number>;
    expect(buildEvaluateExpression(fn)).toBe('(async()=>42)(...[])');
  });

  it('rejects string eval with stray args', () => {
    expect(() => buildEvaluateExpression('document.title', ['ignored']))
      .toThrow('use page.evaluate(fn, ...args)');
  });

  it('rejects non-JSON-serializable function args', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => buildEvaluateExpression((value: unknown) => value, [circular]))
      .toThrow('JSON-serializable');
  });
});

describe('gotoResilient', () => {
  it('passes a plain goto through with one argument', async () => {
    const goto = vi.fn(async () => {});
    await gotoResilient({ goto }, 'https://a.test/');
    expect(goto).toHaveBeenCalledWith('https://a.test/');
  });

  it('retries in the same lease on "Navigation rejected." without releasing it', async () => {
    const goto = vi.fn()
      .mockRejectedValueOnce(new Error('Navigation rejected.'))
      .mockResolvedValueOnce(undefined);
    const closeWindow = vi.fn(async () => {});
    await gotoResilient({ goto, closeWindow } as never, 'https://a.test/');
    expect(goto).toHaveBeenCalledTimes(2);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('falls back to a new tab when the retry is rejected too', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('Navigation rejected.'));
    const newTab = vi.fn(async () => 'p2');
    const setActivePage = vi.fn(async () => {});
    await gotoResilient({ goto, newTab, setActivePage }, 'https://a.test/');
    expect(newTab).toHaveBeenCalledWith('https://a.test/');
    expect(setActivePage).toHaveBeenCalledWith('p2');
  });

  it('rethrows any other error untouched', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(gotoResilient({ goto }, 'https://a.test/')).rejects.toThrow('boom');
  });
});
