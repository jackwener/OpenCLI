/**
 * Tests for API schema drift detection (contract.ts).
 */

import { describe, it, expect } from 'vitest';
import { captureSchema, diffSchema, formatDiff, type Schema, type SchemaDiff } from './contract.js';

// ── captureSchema ────────────────────────────────────────────────────────────

describe('captureSchema', () => {
  it('captures primitives', () => {
    expect(captureSchema('hello')).toEqual({ type: 'string' });
    expect(captureSchema(42)).toEqual({ type: 'number' });
    expect(captureSchema(true)).toEqual({ type: 'boolean' });
    expect(captureSchema(null)).toEqual({ type: 'null' });
    expect(captureSchema(undefined)).toEqual({ type: 'null' });
  });

  it('captures flat object', () => {
    const schema = captureSchema({ id: 1, name: 'test', active: true });
    expect(schema.type).toBe('object');
    expect(schema.properties).toEqual({
      id: { type: 'number' },
      name: { type: 'string' },
      active: { type: 'boolean' },
    });
  });

  it('captures nested object', () => {
    const schema = captureSchema({ user: { name: 'alice', age: 30 } });
    expect(schema.type).toBe('object');
    expect(schema.properties!.user).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    });
  });

  it('captures empty array', () => {
    const schema = captureSchema([]);
    expect(schema).toEqual({ type: 'array', items: { type: 'unknown' } });
  });

  it('captures array of primitives', () => {
    const schema = captureSchema([1, 2, 3]);
    expect(schema).toEqual({ type: 'array', items: { type: 'number' } });
  });

  it('captures array of objects and merges keys', () => {
    const data = [
      { id: 1, title: 'first' },
      { id: 2, title: 'second', extra: true },
    ];
    const schema = captureSchema(data);
    expect(schema.type).toBe('array');
    expect(schema.items!.type).toBe('object');
    // Merged schema includes keys from all elements
    expect(Object.keys(schema.items!.properties!).sort()).toEqual(['extra', 'id', 'title']);
  });

  it('captures nested arrays', () => {
    const schema = captureSchema({ tags: ['a', 'b'] });
    expect(schema.type).toBe('object');
    expect(schema.properties!.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('captures object with null field', () => {
    const schema = captureSchema({ id: 1, avatar: null });
    expect(schema.properties!.avatar).toEqual({ type: 'null' });
  });
});

// ── diffSchema ───────────────────────────────────────────────────────────────

describe('diffSchema', () => {
  it('returns empty array for identical schemas', () => {
    const schema: Schema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
    };
    expect(diffSchema(schema, schema)).toEqual([]);
  });

  it('detects top-level type change', () => {
    const baseline: Schema = { type: 'object', properties: {} };
    const current: Schema = { type: 'array', items: { type: 'string' } };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toEqual([
      { path: '(root)', kind: 'type-changed', baseline: 'object', current: 'array' },
    ]);
  });

  it('detects added field', () => {
    const baseline: Schema = {
      type: 'object',
      properties: { id: { type: 'number' } },
    };
    const current: Schema = {
      type: 'object',
      properties: { id: { type: 'number' }, newField: { type: 'string' } },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ path: 'newField', kind: 'added', current: 'string' });
  });

  it('detects removed field', () => {
    const baseline: Schema = {
      type: 'object',
      properties: { id: { type: 'number' }, removed: { type: 'boolean' } },
    };
    const current: Schema = {
      type: 'object',
      properties: { id: { type: 'number' } },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ path: 'removed', kind: 'removed', baseline: 'boolean' });
  });

  it('detects type change on a field', () => {
    const baseline: Schema = {
      type: 'object',
      properties: { count: { type: 'number' } },
    };
    const current: Schema = {
      type: 'object',
      properties: { count: { type: 'string' } },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toEqual([
      { path: 'count', kind: 'type-changed', baseline: 'number', current: 'string' },
    ]);
  });

  it('detects nested field changes', () => {
    const baseline: Schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    };
    const current: Schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            // email removed, phone added
            phone: { type: 'string' },
          },
        },
      },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toHaveLength(2);
    const paths = diffs.map(d => d.path);
    expect(paths).toContain('user.email');
    expect(paths).toContain('user.phone');
    expect(diffs.find(d => d.path === 'user.email')!.kind).toBe('removed');
    expect(diffs.find(d => d.path === 'user.phone')!.kind).toBe('added');
  });

  it('detects array item schema changes', () => {
    const baseline: Schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'number' }, title: { type: 'string' } },
      },
    };
    const current: Schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' } },
      },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toEqual([
      { path: '[].id', kind: 'type-changed', baseline: 'number', current: 'string' },
    ]);
  });

  it('handles nested array inside object', () => {
    const baseline: Schema = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    };
    const current: Schema = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, score: { type: 'number' } },
          },
        },
      },
    };
    const diffs = diffSchema(baseline, current);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ path: 'data[].score', kind: 'added', current: 'number' });
  });
});

// ── formatDiff ───────────────────────────────────────────────────────────────

describe('formatDiff', () => {
  it('returns no-change message for empty diffs', () => {
    expect(formatDiff([])).toBe('No schema changes detected.');
  });

  it('formats added field', () => {
    const diffs: SchemaDiff[] = [{ path: 'newField', kind: 'added', current: 'string' }];
    const output = formatDiff(diffs);
    expect(output).toContain('1 schema change(s)');
    expect(output).toContain('+ newField');
    expect(output).toContain('field added');
  });

  it('formats removed field', () => {
    const diffs: SchemaDiff[] = [{ path: 'oldField', kind: 'removed', baseline: 'number' }];
    const output = formatDiff(diffs);
    expect(output).toContain('- oldField');
    expect(output).toContain('was number');
    expect(output).toContain('field removed');
  });

  it('formats type change', () => {
    const diffs: SchemaDiff[] = [
      { path: 'count', kind: 'type-changed', baseline: 'number', current: 'string' },
    ];
    const output = formatDiff(diffs);
    expect(output).toContain('~ count');
    expect(output).toContain('number -> string');
    expect(output).toContain('type changed');
  });

  it('formats multiple diffs', () => {
    const diffs: SchemaDiff[] = [
      { path: 'a', kind: 'added', current: 'string' },
      { path: 'b', kind: 'removed', baseline: 'number' },
      { path: 'c', kind: 'type-changed', baseline: 'boolean', current: 'string' },
    ];
    const output = formatDiff(diffs);
    expect(output).toContain('3 schema change(s)');
  });
});

// ── End-to-end: captureSchema → diffSchema ──────────────────────────────────

describe('end-to-end drift detection', () => {
  it('detects when an API adds a field', () => {
    const v1 = { data: [{ id: 1, title: 'hello' }] };
    const v2 = { data: [{ id: 1, title: 'hello', slug: 'hello-1' }] };

    const baselineSchema = captureSchema(v1);
    const currentSchema = captureSchema(v2);
    const diffs = diffSchema(baselineSchema, currentSchema);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('data[].slug');
    expect(diffs[0].kind).toBe('added');
  });

  it('detects when an API changes a field type', () => {
    const v1 = { count: 42, items: [{ id: 1 }] };
    const v2 = { count: '42', items: [{ id: 1 }] };

    const diffs = diffSchema(captureSchema(v1), captureSchema(v2));

    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('count');
    expect(diffs[0].kind).toBe('type-changed');
    expect(diffs[0].baseline).toBe('number');
    expect(diffs[0].current).toBe('string');
  });

  it('detects when an API removes a field', () => {
    const v1 = { meta: { page: 1, total: 100 } };
    const v2 = { meta: { page: 1 } };

    const diffs = diffSchema(captureSchema(v1), captureSchema(v2));

    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('meta.total');
    expect(diffs[0].kind).toBe('removed');
  });

  it('reports no drift for identical responses', () => {
    const response = { status: 'ok', data: [{ id: 1, name: 'a' }] };
    const diffs = diffSchema(captureSchema(response), captureSchema(response));
    expect(diffs).toHaveLength(0);
  });
});
