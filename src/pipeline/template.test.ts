/**
 * Tests for the pipeline template engine: render, evalExpr, resolvePath.
 */

import { describe, it, expect } from 'vitest';
import { render, evalExpr, resolvePath, normalizeEvaluateSource } from './template.js';

describe('resolvePath', () => {
  it('resolves args path', () => {
    expect(resolvePath('args.limit', { args: { limit: 20 } })).toBe(20);
  });
  it('resolves nested args path', () => {
    expect(resolvePath('args.query.keyword', { args: { query: { keyword: 'test' } } })).toBe('test');
  });
  it('resolves item path', () => {
    expect(resolvePath('item.title', { item: { title: 'Hello' } })).toBe('Hello');
  });
  it('resolves implicit item path (no prefix)', () => {
    expect(resolvePath('title', { item: { title: 'World' } })).toBe('World');
  });
  it('resolves index', () => {
    expect(resolvePath('index', { index: 5 })).toBe(5);
  });
  it('resolves data path', () => {
    expect(resolvePath('data.items', { data: { items: [1, 2, 3] } })).toEqual([1, 2, 3]);
  });
  it('returns null for missing path', () => {
    expect(resolvePath('args.missing', { args: {} })).toBeUndefined();
  });
  it('resolves array index', () => {
    expect(resolvePath('data.0', { data: ['a', 'b'] })).toBe('a');
  });
});

describe('evalExpr', () => {
  it('evaluates default filter', () => {
    expect(evalExpr('args.limit | default(20)', { args: {} })).toBe(20);
  });
  it('uses actual value over default', () => {
    expect(evalExpr('args.limit | default(20)', { args: { limit: 10 } })).toBe(10);
  });
  it('evaluates string default', () => {
    expect(evalExpr("args.name | default('unknown')", { args: {} })).toBe('unknown');
  });
  it('evaluates arithmetic: index + 1', () => {
    expect(evalExpr('index + 1', { index: 0 })).toBe(1);
  });
  it('evaluates arithmetic: index * 2', () => {
    expect(evalExpr('index * 2', { index: 5 })).toBe(10);
  });
  it('evaluates || fallback', () => {
    expect(evalExpr("item.name || 'N/A'", { item: {} })).toBe('N/A');
  });
  it('evaluates || with truthy left', () => {
    expect(evalExpr("item.name || 'N/A'", { item: { name: 'Alice' } })).toBe('Alice');
  });
  it('evaluates chained || fallback (issue #303)', () => {
    // When first two are falsy, should evaluate through to the string literal
    expect(evalExpr("item.a || item.b || 'default'", { item: {} })).toBe('default');
  });
  it('evaluates chained || with middle value truthy', () => {
    expect(evalExpr("item.a || item.b || 'default'", { item: { b: 'middle' } })).toBe('middle');
  });
  it('evaluates chained || with first value truthy', () => {
    expect(evalExpr("item.a || item.b || 'default'", { item: { a: 'first', b: 'middle' } })).toBe('first');
  });
  it('evaluates || with 0 as falsy left (JS semantics)', () => {
    expect(evalExpr("item.count || 'N/A'", { item: { count: 0 } })).toBe('N/A');
  });
  it('evaluates || with empty string as falsy left', () => {
    expect(evalExpr("item.name || 'unknown'", { item: { name: '' } })).toBe('unknown');
  });
  it('evaluates || with numeric fallback returning number type', () => {
    expect(evalExpr('item.a || 42', { item: {} })).toBe(42);
  });
  it('evaluates 4-way chained ||', () => {
    expect(evalExpr("item.a || item.b || item.c || 'last'", { item: { c: 'third' } })).toBe('third');
  });
  it('handles || combined with pipe filter', () => {
    expect(evalExpr("item.a || item.b | upper", { item: { b: 'hello' } })).toBe('HELLO');
  });
  it('resolves simple path', () => {
    expect(evalExpr('item.title', { item: { title: 'Test' } })).toBe('Test');
  });
  it('evaluates JS helper expressions', () => {
    expect(evalExpr('encodeURIComponent(args.keyword)', { args: { keyword: 'hello world' } })).toBe('hello%20world');
  });
  it('evaluates ternary expressions', () => {
    expect(evalExpr("args.kind === 'tech' ? 'technology' : args.kind", { args: { kind: 'tech' } })).toBe('technology');
  });
  it('evaluates method calls on values', () => {
    expect(evalExpr("args.username.startsWith('@') ? args.username : '@' + args.username", { args: { username: 'alice' } })).toBe('@alice');
  });
  it('rejects constructor-based sandbox escapes', () => {
    expect(evalExpr("args['cons' + 'tructor']['constructor']('return process')()", { args: {} })).toBeUndefined();
  });
  it('applies join filter', () => {
    expect(evalExpr('item.tags | join(,)', { item: { tags: ['a', 'b', 'c'] } })).toBe('a,b,c');
  });
  it('applies upper filter', () => {
    expect(evalExpr('item.name | upper', { item: { name: 'hello' } })).toBe('HELLO');
  });
  it('applies lower filter', () => {
    expect(evalExpr('item.name | lower', { item: { name: 'HELLO' } })).toBe('hello');
  });
  it('applies truncate filter', () => {
    expect(evalExpr('item.text | truncate(5)', { item: { text: 'Hello World!' } })).toBe('Hello...');
  });
  it('chains filters', () => {
    expect(evalExpr('item.name | upper | truncate(3)', { item: { name: 'hello' } })).toBe('HEL...');
  });
  it('applies length filter', () => {
    expect(evalExpr('item.items | length', { item: { items: [1, 2, 3] } })).toBe(3);
  });
  it('applies json filter to strings with quotes', () => {
    expect(evalExpr('args.keyword | json', { args: { keyword: "O'Reilly" } })).toBe('"O\'Reilly"');
  });
  it('applies json filter to nullish values', () => {
    expect(evalExpr('args.keyword | json', { args: {} })).toBe('null');
  });
});

describe('render', () => {
  it('renders full expression', () => {
    expect(render('${{ args.limit }}', { args: { limit: 30 } })).toBe(30);
  });
  it('renders inline expression in string', () => {
    expect(render('Hello ${{ item.name }}!', { item: { name: 'World' } })).toBe('Hello World!');
  });
  it('renders multiple inline expressions', () => {
    expect(render('${{ item.first }}-${{ item.second }}', { item: { first: 'X', second: 'Y' } })).toBe('X-Y');
  });
  it('returns non-string values as-is', () => {
    expect(render(42, {})).toBe(42);
    expect(render(null, {})).toBeNull();
    expect(render(undefined, {})).toBeUndefined();
  });
  it('returns full expression result as native type', () => {
    expect(render('${{ args.list }}', { args: { list: [1, 2, 3] } })).toEqual([1, 2, 3]);
  });
  it('renders URL template', () => {
    expect(render('https://api.example.com/search?q=${{ args.keyword }}', { args: { keyword: 'test' } })).toBe('https://api.example.com/search?q=test');
  });
  it('renders inline helper expressions', () => {
    expect(render('https://example.com/search?q=${{ encodeURIComponent(args.keyword) }}', { args: { keyword: 'hello world' } })).toBe('https://example.com/search?q=hello%20world');
  });
  it('renders full multiline expressions', () => {
    expect(render("${{\n  args.topic ? `https://medium.com/tag/${args.topic}` : 'https://medium.com/tag/technology'\n}}", { args: { topic: 'ai' } })).toBe('https://medium.com/tag/ai');
  });
  it('renders block expressions with surrounding whitespace', () => {
    expect(render("\n  ${{ args.kind === 'tech' ? 'technology' : args.kind }}\n", { args: { kind: 'tech' } })).toBe('technology');
  });
});

describe('normalizeEvaluateSource', () => {
  it('wraps bare expression', () => {
    expect(normalizeEvaluateSource('document.title')).toBe('() => (document.title)');
  });
  it('passes through arrow function', () => {
    expect(normalizeEvaluateSource('() => 42')).toBe('() => 42');
  });
  it('passes through async arrow function', () => {
    const src = 'async () => { return 1; }';
    expect(normalizeEvaluateSource(src)).toBe(src);
  });
  it('passes through named function', () => {
    const src = 'function foo() { return 1; }';
    expect(normalizeEvaluateSource(src)).toBe(src);
  });
  it('wraps IIFE pattern', () => {
    const src = '(async () => { return 1; })()';
    expect(normalizeEvaluateSource(src)).toBe(`() => (${src})`);
  });
  it('handles empty string', () => {
    expect(normalizeEvaluateSource('')).toBe('() => undefined');
  });
});
