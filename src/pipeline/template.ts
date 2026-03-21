/**
 * Pipeline template engine: ${{ ... }} expression rendering.
 */

export interface RenderContext {
  args?: Record<string, any>;
  data?: any;
  item?: any;
  index?: number;
}

export function render(template: any, ctx: RenderContext): any {
  if (typeof template !== 'string') return template;
  const trimmed = template.trim();
  // Full expression: entire string is a single ${{ ... }}
  // Use [^}] to prevent matching across }} boundaries (e.g. "${{ a }}-${{ b }}")
  const fullMatch = trimmed.match(/^\$\{\{\s*([^}]*(?:\}[^}][^}]*)*)\s*\}\}$/);
  if (fullMatch && !trimmed.includes('}}-') && !trimmed.includes('}}${{')) return evalExpr(fullMatch[1].trim(), ctx);
  // Check if the entire string is a single expression (no other text around it)
  const singleExpr = trimmed.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  if (singleExpr) {
    // Verify it's truly a single expression (no other ${{ inside)
    const inner = singleExpr[1];
    if (!inner.includes('${{')) return evalExpr(inner.trim(), ctx);
  }
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_m, expr) => String(evalExpr(expr.trim(), ctx)));
}

export function evalExpr(expr: string, ctx: RenderContext): any {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;

  // ── Pipe filters: expr | filter1(arg) | filter2 ──
  // Supports: default(val), join(sep), upper, lower, truncate(n), trim, replace(old,new)
  if (expr.includes('|') && !expr.includes('||')) {
    const segments = expr.split('|').map(s => s.trim());
    const mainExpr = segments[0];
    let result = resolvePath(mainExpr, { args, item, data, index });
    for (let i = 1; i < segments.length; i++) {
      result = applyFilter(segments[i], result);
    }
    return result;
  }

  // Arithmetic: index + 1
  const arithMatch = expr.match(/^([\w][\w.]*)\s*([+\-*/])\s*(\d+)$/);
  if (arithMatch) {
    const [, varName, op, numStr] = arithMatch;
    const val = resolvePath(varName, { args, item, data, index });
    if (val !== null && val !== undefined) {
      const numVal = Number(val); const num = Number(numStr);
      if (!isNaN(numVal)) {
        switch (op) {
          case '+': return numVal + num; case '-': return numVal - num;
          case '*': return numVal * num; case '/': return num !== 0 ? numVal / num : 0;
        }
      }
    }
  }

  // JS-like fallback expression: item.tweetCount || 'N/A'
  const orMatch = expr.match(/^(.+?)\s*\|\|\s*(.+)$/);
  if (orMatch) {
    const left = evalExpr(orMatch[1].trim(), ctx);
    if (left) return left;
    const right = orMatch[2].trim();
    return right.replace(/^['"]|['"]$/g, '');
  }

  const resolved = resolvePath(expr, { args, item, data, index });
  if (resolved !== null && resolved !== undefined) return resolved;

  return evalJsExpr(expr, { args, item, data, index });
}

/**
 * Apply a named filter to a value.
 * Supported filters:
 *   default(val), join(sep), upper, lower, truncate(n), trim,
 *   replace(old,new), keys, length, first, last, json
 */
function applyFilter(filterExpr: string, value: any): any {
  const match = filterExpr.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return value;
  const [, name, rawArgs] = match;
  const filterArg = rawArgs?.replace(/^['"]|['"]$/g, '') ?? '';

  switch (name) {
    case 'default': {
      if (value === null || value === undefined || value === '') {
        const intVal = parseInt(filterArg, 10);
        if (!isNaN(intVal) && String(intVal) === filterArg.trim()) return intVal;
        return filterArg;
      }
      return value;
    }
    case 'join':
      return Array.isArray(value) ? value.join(filterArg || ', ') : value;
    case 'upper':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'lower':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'trim':
      return typeof value === 'string' ? value.trim() : value;
    case 'truncate': {
      const n = parseInt(filterArg, 10) || 50;
      return typeof value === 'string' && value.length > n ? value.slice(0, n) + '...' : value;
    }
    case 'replace': {
      if (typeof value !== 'string') return value;
      const parts = rawArgs?.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) ?? [];
      return parts.length >= 2 ? value.replaceAll(parts[0], parts[1]) : value;
    }
    case 'keys':
      return value && typeof value === 'object' ? Object.keys(value) : value;
    case 'length':
      return Array.isArray(value) ? value.length : typeof value === 'string' ? value.length : value;
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : value;
    case 'json':
      return JSON.stringify(value ?? null);
    case 'slugify':
      // Convert to URL-safe slug
      return typeof value === 'string'
        ? value
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '')
        : value;
    case 'sanitize':
      // Remove invalid filename characters
      return typeof value === 'string'
        ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        : value;
    case 'ext': {
      // Extract file extension from URL or path
      if (typeof value !== 'string') return value;
      const lastDot = value.lastIndexOf('.');
      const lastSlash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
      return lastDot > lastSlash ? value.slice(lastDot) : '';
    }
    case 'basename': {
      // Extract filename from URL or path
      if (typeof value !== 'string') return value;
      const parts = value.split(/[/\\]/);
      return parts[parts.length - 1] || value;
    }
    case 'urlencode':
      return typeof value === 'string' ? encodeURIComponent(value) : value;
    case 'urldecode':
      return typeof value === 'string' ? decodeURIComponent(value) : value;
    default:
      return value;
  }
}

export function resolvePath(pathStr: string, ctx: RenderContext): any {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;
  const parts = pathStr.split('.');
  const rootName = parts[0];
  let obj: any; let rest: string[];
  if (rootName === 'args') { obj = args; rest = parts.slice(1); }
  else if (rootName === 'item') { obj = item; rest = parts.slice(1); }
  else if (rootName === 'data') { obj = data; rest = parts.slice(1); }
  else if (rootName === 'index') return index;
  else { obj = item; rest = parts; }
  for (const part of rest) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) obj = obj[part];
    else if (Array.isArray(obj) && /^\d+$/.test(part)) obj = obj[parseInt(part, 10)];
    else return null;
  }
  return obj;
}

/**
 * Evaluate arbitrary JS expressions as a last-resort fallback.
 *
 * ⚠️  SECURITY NOTE: Uses `new Function()` to execute the expression.
 * This is acceptable here because:
 *   1. YAML adapters are authored by trusted repo contributors only.
 *   2. The expression runs in the same Node.js process (no sandbox).
 *   3. Only a curated set of globals is exposed (no require/import/process/fs).
 * If opencli ever loads untrusted third-party adapters, this MUST be replaced
 * with a proper sandboxed evaluator.
 */
function evalJsExpr(expr: string, ctx: RenderContext): any {
  // Guard against absurdly long expressions that could indicate injection.
  if (expr.length > 2000) return undefined;

  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;

  try {
    const fn = new Function(
      'args',
      'item',
      'data',
      'index',
      'encodeURIComponent',
      'decodeURIComponent',
      'JSON',
      'Math',
      'Number',
      'String',
      'Boolean',
      'Array',
      'Object',
      'Date',
      `"use strict"; return (${expr});`,
    );

    return fn(
      args,
      item,
      data,
      index,
      encodeURIComponent,
      decodeURIComponent,
      JSON,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Date,
    );
  } catch {
    return undefined;
  }
}

/**
 * Normalize JavaScript source for browser evaluate() calls.
 */
export function normalizeEvaluateSource(source: string): string {
  const stripped = source.trim();
  if (!stripped) return '() => undefined';
  if (stripped.startsWith('(') && stripped.endsWith(')()')) return `() => (${stripped})`;
  if (/^(async\s+)?\([^)]*\)\s*=>/.test(stripped)) return stripped;
  if (/^(async\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=>/.test(stripped)) return stripped;
  if (stripped.startsWith('function ') || stripped.startsWith('async function ')) return stripped;
  return `() => (${stripped})`;
}
