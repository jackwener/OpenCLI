/**
 * API schema drift detection.
 *
 * Captures the structural schema of a JSON response, compares it against
 * a saved baseline, and reports differences (fields added, removed, or
 * type-changed). Used by `opencli contract` to detect when upstream APIs
 * silently change their response shape.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Schema types ─────────────────────────────────────────────────────────────

export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'unknown';

export interface Schema {
  type: SchemaType;
  /** For objects: keys → child schemas */
  properties?: Record<string, Schema>;
  /** For arrays: schema of the representative element (union of all elements) */
  items?: Schema;
}

export interface SchemaDiff {
  path: string;
  kind: 'added' | 'removed' | 'type-changed' | 'items-changed';
  baseline?: string;
  current?: string;
}

// ── Schema capture ───────────────────────────────────────────────────────────

/**
 * Recursively traverse a JSON value and extract its structural schema.
 * Arrays are represented by merging all element schemas into one.
 */
export function captureSchema(data: unknown): Schema {
  if (data === null || data === undefined) {
    return { type: 'null' };
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: 'array', items: { type: 'unknown' } };
    }
    // Merge schemas of all elements to capture the "union" element type.
    let merged = captureSchema(data[0]);
    for (let i = 1; i < data.length; i++) {
      merged = mergeSchemas(merged, captureSchema(data[i]));
    }
    return { type: 'array', items: merged };
  }

  if (typeof data === 'object') {
    const properties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      properties[key] = captureSchema(value);
    }
    return { type: 'object', properties };
  }

  if (typeof data === 'string') return { type: 'string' };
  if (typeof data === 'number') return { type: 'number' };
  if (typeof data === 'boolean') return { type: 'boolean' };

  return { type: 'unknown' };
}

/**
 * Merge two schemas: if both are objects merge their properties;
 * if types differ, prefer the first but keep the broader shape.
 */
function mergeSchemas(a: Schema, b: Schema): Schema {
  // Same primitive type — nothing to merge
  if (a.type === b.type && a.type !== 'object' && a.type !== 'array') {
    return a;
  }

  // Both objects — merge property sets
  if (a.type === 'object' && b.type === 'object') {
    const merged: Record<string, Schema> = { ...a.properties };
    for (const [key, schema] of Object.entries(b.properties ?? {})) {
      if (merged[key]) {
        merged[key] = mergeSchemas(merged[key], schema);
      } else {
        merged[key] = schema;
      }
    }
    return { type: 'object', properties: merged };
  }

  // Both arrays — merge their item schemas
  if (a.type === 'array' && b.type === 'array') {
    const aItems = a.items ?? { type: 'unknown' as SchemaType };
    const bItems = b.items ?? { type: 'unknown' as SchemaType };
    return { type: 'array', items: mergeSchemas(aItems, bItems) };
  }

  // Type mismatch — return first (baseline wins)
  return a;
}

// ── Schema diff ──────────────────────────────────────────────────────────────

/**
 * Compare a baseline schema against a current schema.
 * Returns a list of differences.
 */
export function diffSchema(baseline: Schema, current: Schema, prefix = ''): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];
  const currentPath = prefix || '(root)';

  // Top-level type change
  if (baseline.type !== current.type) {
    diffs.push({
      path: currentPath,
      kind: 'type-changed',
      baseline: baseline.type,
      current: current.type,
    });
    return diffs;
  }

  // Object comparison: check for added/removed/changed properties
  if (baseline.type === 'object' && current.type === 'object') {
    const baseKeys = new Set(Object.keys(baseline.properties ?? {}));
    const curKeys = new Set(Object.keys(current.properties ?? {}));

    // Removed fields
    for (const key of baseKeys) {
      if (!curKeys.has(key)) {
        diffs.push({
          path: prefix ? `${prefix}.${key}` : key,
          kind: 'removed',
          baseline: (baseline.properties![key]).type,
        });
      }
    }

    // Added fields
    for (const key of curKeys) {
      if (!baseKeys.has(key)) {
        diffs.push({
          path: prefix ? `${prefix}.${key}` : key,
          kind: 'added',
          current: (current.properties![key]).type,
        });
      }
    }

    // Recurse into shared fields
    for (const key of baseKeys) {
      if (curKeys.has(key)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        diffs.push(
          ...diffSchema(
            baseline.properties![key],
            current.properties![key],
            childPath,
          ),
        );
      }
    }
  }

  // Array comparison: diff item schemas
  if (baseline.type === 'array' && current.type === 'array') {
    const baseItems = baseline.items ?? { type: 'unknown' as SchemaType };
    const curItems = current.items ?? { type: 'unknown' as SchemaType };
    const itemPath = prefix ? `${prefix}[]` : '[]';
    diffs.push(...diffSchema(baseItems, curItems, itemPath));
  }

  return diffs;
}

// ── Human-readable diff formatting ──────────────────────────────────────────

/**
 * Format a list of diffs into a human-readable string.
 */
export function formatDiff(diffs: SchemaDiff[]): string {
  if (diffs.length === 0) {
    return 'No schema changes detected.';
  }

  const lines: string[] = [`${diffs.length} schema change(s) detected:`, ''];

  for (const d of diffs) {
    switch (d.kind) {
      case 'added':
        lines.push(`  + ${d.path}  (${d.current}) — field added`);
        break;
      case 'removed':
        lines.push(`  - ${d.path}  (was ${d.baseline}) — field removed`);
        break;
      case 'type-changed':
        lines.push(`  ~ ${d.path}  ${d.baseline} -> ${d.current} — type changed`);
        break;
      case 'items-changed':
        lines.push(`  ~ ${d.path}  items changed`);
        break;
    }
  }

  return lines.join('\n');
}

// ── Schema tree display ─────────────────────────────────────────────────────

/**
 * Format a schema as a readable tree for terminal output.
 */
export function formatSchemaTree(schema: Schema, indent = ''): string {
  const lines: string[] = [];

  if (schema.type === 'object' && schema.properties) {
    if (indent === '') lines.push(`${indent}(object)`);
    const keys = Object.keys(schema.properties);
    for (const key of keys) {
      const child = schema.properties[key];
      if (child.type === 'object' && child.properties) {
        lines.push(`${indent}  ${key}: (object)`);
        lines.push(formatSchemaTree(child, indent + '    '));
      } else if (child.type === 'array') {
        const itemType = child.items?.type ?? 'unknown';
        if (child.items?.type === 'object' && child.items.properties) {
          lines.push(`${indent}  ${key}: (array of object)`);
          lines.push(formatSchemaTree(child.items, indent + '    '));
        } else {
          lines.push(`${indent}  ${key}: (array of ${itemType})`);
        }
      } else {
        lines.push(`${indent}  ${key}: ${child.type}`);
      }
    }
  } else if (schema.type === 'array' && schema.items) {
    lines.push(`${indent}(array of ${schema.items.type})`);
    if (schema.items.type === 'object') {
      lines.push(formatSchemaTree(schema.items, indent));
    }
  } else {
    lines.push(`${indent}(${schema.type})`);
  }

  return lines.join('\n');
}

// ── Contract storage ────────────────────────────────────────────────────────

function contractDir(site: string): string {
  return path.join(os.homedir(), '.opencli', 'contracts', site);
}

function contractPath(site: string, command: string): string {
  return path.join(contractDir(site), `${command}.json`);
}

export interface ContractFile {
  site: string;
  command: string;
  schema: Schema;
  capturedAt: string;
}

/**
 * Save a schema snapshot to disk.
 */
export function saveContract(site: string, command: string, schema: Schema): string {
  const dir = contractDir(site);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = contractPath(site, command);
  const data: ContractFile = {
    site,
    command,
    schema,
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  return filePath;
}

/**
 * Load a saved contract, or null if none exists.
 */
export function loadContract(site: string, command: string): ContractFile | null {
  const filePath = contractPath(site, command);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ContractFile;
}

/**
 * List all saved contracts. Returns an array of { site, command, capturedAt }.
 */
export function listContracts(): Array<{ site: string; command: string; capturedAt: string }> {
  const baseDir = path.join(os.homedir(), '.opencli', 'contracts');
  if (!fs.existsSync(baseDir)) return [];

  const results: Array<{ site: string; command: string; capturedAt: string }> = [];
  const sites = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of sites) {
    if (!entry.isDirectory()) continue;
    const site = entry.name;
    const siteDir = path.join(baseDir, site);
    const files = fs.readdirSync(siteDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(siteDir, file), 'utf-8');
        const contract = JSON.parse(raw) as ContractFile;
        results.push({
          site: contract.site,
          command: contract.command,
          capturedAt: contract.capturedAt,
        });
      } catch {
        // Skip malformed files
      }
    }
  }

  return results;
}
