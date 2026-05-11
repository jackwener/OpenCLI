/**
 * Pipeline template engine: ${{ ... }} expression rendering.
 */

import vm from 'node:vm';

export interface RenderContext {
  args?: Record<string, unknown>;
  data?: unknown;
  root?: unknown;
  item?: unknown;
  index?: number;
}

import { isRecord } from '../utils.js';

export function render(template: unknown, ctx: RenderContext): unknown {
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

export function evalExpr(expr: string, ctx: RenderContext): unknown {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const root = ctx.root;
  const index = ctx.index ?? 0;

  // ── Pipe filters: expr | filter1(arg) | filter2 ──
  // Split on single | (not ||) so "item.a || item.b | upper" works correctly.
  const pipeSegments = expr.split(/(?<!\|)\|(?!\|)/).map(s => s.trim());
  if (pipeSegments.length > 1) {
    let result = evalExpr(pipeSegments[0], ctx);
    for (let i = 1; i < pipeSegments.length; i++) {
      result = applyFilter(pipeSegments[i], result);
    }
    return result;
  }

  // Fast path: quoted string literal — skip VM overhead
  const strLit = expr.match(/^(['"])(.*)\1$/);
  if (strLit) return strLit[2];

  // Fast path: numeric literal
  if (/^\d+(\.\d+)?$/.test(expr)) return Number(expr);

  // Try resolving as a simple dotted path (item.foo.bar, args.limit, index)
  const resolved = resolvePath(expr, { args, item, data, root, index });
  if (resolved !== null && resolved !== undefined) return resolved;

  // Fallback: evaluate as JS in a sandboxed VM.
  // Handles ||, ??, arithmetic, ternary, method calls, etc. natively.
  return evalJsExpr(expr, { args, item, data, root, index });
}

/**
 * Apply a named filter to a value.
 * Supported filters:
 *   default(val), join(sep), upper, lower, truncate(n), trim,
 *   replace(old,new), keys, length, first, last, json
 */
function applyFilter(filterExpr: string, value: unknown): unknown {
  const match = filterExpr.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return value;
  const [, name, rawArgs] = match;
  const filterArg = rawArgs?.replace(/^['"]|['"]$/g, '') ?? '';

  switch (name) {
    case 'default': {
      if (value === null || value === undefined || value === '') {
        const intVal = parseInt(filterArg, 10);
        if (!Number.isNaN(intVal) && String(intVal) === filterArg.trim()) return intVal;
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
      return typeof value === 'string' && value.length > n ? `${value.slice(0, n)}...` : value;
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
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional - strips C0 control chars from filenames
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

export function resolvePath(pathStr: string, ctx: RenderContext): unknown {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const root = ctx.root;
  const index = ctx.index ?? 0;
  const parts = pathStr.split('.');
  const rootName = parts[0];
  let obj: unknown;
  let rest: string[];
  if (rootName === 'args') { obj = args; rest = parts.slice(1); }
  else if (rootName === 'item') { obj = item; rest = parts.slice(1); }
  else if (rootName === 'data') { obj = data; rest = parts.slice(1); }
  else if (rootName === 'root') { obj = root; rest = parts.slice(1); }
  else if (rootName === 'index') return index;
  else { obj = item; rest = parts; }
  for (const part of rest) {
    if (isRecord(obj)) obj = obj[part];
    else if (Array.isArray(obj) && /^\d+$/.test(part)) obj = obj[parseInt(part, 10)];
    else return null;
  }
  return obj;
}

/**
 * Evaluate arbitrary JS expressions as a last-resort fallback.
 * Runs inside a `node:vm` sandbox with dynamic code generation disabled.
 *
 * Compiled functions are cached by expression string to avoid re-creating
 * VM contexts on every invocation — critical for loops where the same
 * expression is evaluated hundreds of times.
 */
const FORBIDDEN_EXPR_PATTERNS = /\b(constructor|__proto__|prototype|globalThis|process|require|import|eval)\b/;

/**
 * Deep-copy plain data to sever prototype chains, preventing sandbox escape
 * via `args.constructor.constructor('return process')()` etc.
 *
 * Uses a WeakMap cache keyed by object reference: when the same object
 * (e.g. `args` or `data`) is passed repeatedly across loop iterations,
 * the expensive JSON round-trip is performed only once. The WeakMap
 * lets entries be GC'd when the source object is no longer referenced.
 */
/**
 * Cache serialized JSON strings (not parsed objects) by source reference.
 * Caching the parsed object would be unsafe: the VM sandbox could mutate it,
 * and the polluted version would leak to subsequent calls. By caching the
 * string and returning a fresh JSON.parse() each time, every evaluation gets
 * its own clean deep-copy while still avoiding redundant JSON.stringify()
 * for the same unchanged source object across loop iterations.
 */
const _sanitizeCache = new WeakMap<object, string>();

function sanitizeContext(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object' && typeof obj !== 'function') return obj;
  const objRef = obj as object;
  const cached = _sanitizeCache.get(objRef);
  if (cached !== undefined) return JSON.parse(cached);
  try {
    const jsonStr = JSON.stringify(obj);
    _sanitizeCache.set(objRef, jsonStr);
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

/** LRU-bounded cache for compiled VM scripts — prevents unbounded memory growth. */
const MAX_VM_CACHE_SIZE = 256;
const _vmCache = new Map<string, vm.Script>();

function getOrCompileScript(expr: string): vm.Script {
  let script = _vmCache.get(expr);
  if (script) return script;

  // Evict oldest entry when cache is full
  if (_vmCache.size >= MAX_VM_CACHE_SIZE) {
    const firstKey = _vmCache.keys().next().value;
    if (firstKey !== undefined) _vmCache.delete(firstKey);
  }

  script = new vm.Script(`(${expr})`);
  _vmCache.set(expr, script);
  return script;
}

/**
 * Reusable VM sandbox context.
 *
 * vm.createContext() is expensive (~0.3ms per call) because it creates a new
 * V8 context with its own global object. In pipeline loops (map/filter over
 * hundreds of items), this adds up to significant overhead.
 *
 * Instead, we create the context once and mutate the sandbox properties
 * before each evaluation. This is safe because:
 *   1. Sandbox properties are sanitized (deep-copied) before assignment
 *   2. Scripts run with a 50ms timeout
 *   3. codeGeneration is disabled (no eval/Function inside the sandbox)
 */
let _reusableSandbox: Record<string, unknown> | null = null;
let _reusableContext: vm.Context | null = null;

function getReusableContext(): { sandbox: Record<string, unknown>; context: vm.Context } {
  if (_reusableSandbox && _reusableContext) {
    return { sandbox: _reusableSandbox, context: _reusableContext };
  }
  _reusableSandbox = {
    args: {},
    item: {},
    data: null,
    root: null,
    index: 0,
    encodeURIComponent,
    decodeURIComponent,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Date,
  };
  _reusableContext = vm.createContext(_reusableSandbox, {
    codeGeneration: { strings: false, wasm: false },
  });
  return { sandbox: _reusableSandbox, context: _reusableContext };
}

/** Properties that are part of the sandbox's initial shape and safe to keep. */
const SANDBOX_WHITELIST = new Set([
  'args', 'item', 'data', 'root', 'index',
  'encodeURIComponent', 'decodeURIComponent',
  'JSON', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Date',
]);

function evalJsExpr(expr: string, ctx: RenderContext): unknown {
  // Guard against absurdly long expressions that could indicate injection.
  if (expr.length > 2000) return undefined;

  // Block obvious sandbox escape attempts.
  if (FORBIDDEN_EXPR_PATTERNS.test(expr)) return undefined;

  try {
    const script = getOrCompileScript(expr);
    const { sandbox, context } = getReusableContext();

    // Clean non-whitelisted properties that a previous script may have added.
    // Without this, `${{ x = 42 }}` would leak `x` into subsequent evaluations.
    for (const key of Object.keys(sandbox)) {
      if (!SANDBOX_WHITELIST.has(key)) {
        delete sandbox[key];
      }
    }

    // Update mutable sandbox properties — sanitizeContext severs prototype chains.
    sandbox.args = sanitizeContext(ctx.args ?? {});
    sandbox.item = sanitizeContext(ctx.item ?? {});
    sandbox.data = sanitizeContext(ctx.data);
    sandbox.root = sanitizeContext(ctx.root);
    sandbox.index = ctx.index ?? 0;
    return script.runInContext(context, { timeout: 50 });
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
