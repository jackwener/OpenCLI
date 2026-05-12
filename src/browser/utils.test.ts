import { describe, expect, it } from 'vitest';
import { buildEvaluateExpression, wrapForEval } from './utils.js';

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
