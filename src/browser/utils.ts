/**
 * Utility functions for browser operations
 */

type EvaluateFunction = (...args: any[]) => unknown;

function describeJsonError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Serialize a function-form page.evaluate call for CDP Runtime.evaluate.
 *
 * Functions execute in the browser page context, so they cannot close over
 * Node-side variables. Pass external values as JSON-serializable args instead.
 */
export function serializeFunctionForEval(fn: EvaluateFunction, args: readonly unknown[] = []): string {
  const source = fn.toString().trim();
  const isFunctionSource = /^(async\s+)?function[\s(]/.test(source)
    || /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(source);
  if (!isFunctionSource || source.includes('[native code]')) {
    throw new Error('page.evaluate(fn) requires a serializable arrow/function expression');
  }

  let serializedArgs: string;
  try {
    serializedArgs = JSON.stringify(args);
  } catch (err) {
    throw new Error(`page.evaluate arguments must be JSON-serializable: ${describeJsonError(err)}`);
  }
  if (serializedArgs === undefined) {
    throw new Error('page.evaluate arguments must be JSON-serializable');
  }

  return `(${source})(...${serializedArgs})`;
}

/**
 * Wrap JS code for CDP Runtime.evaluate:
 * - Already an IIFE `(...)()` → send as-is
 * - Arrow/function literal → wrap as IIFE `(code)()`
 * - `new Promise(...)` or raw expression → send as-is (expression)
 */
export function wrapForEval(js: string): string {
  if (typeof js !== 'string') return 'undefined';
  const code = js.trim();
  if (!code) return 'undefined';

  // Already an IIFE: `(async () => { ... })()` or `(function() {...})()`
  if (/^\([\s\S]*\)\s*\(.*\)\s*$/.test(code)) return code;

  // Arrow function: `() => ...` or `async () => ...`
  if (/^(async\s+)?(\([^)]*\)|[A-Za-z_]\w*)\s*=>/.test(code)) return `(${code})()`;

  // Function declaration: `function ...` or `async function ...`
  if (/^(async\s+)?function[\s(]/.test(code)) return `(${code})()`;

  // Everything else: bare expression, `new Promise(...)`, etc. → evaluate directly
  return code;
}

export function buildEvaluateExpression(input: string | EvaluateFunction, args: readonly unknown[] = []): string {
  if (typeof input === 'function') {
    return serializeFunctionForEval(input, args);
  }
  if (args.length > 0) {
    throw new Error('page.evaluate string input does not accept args; use page.evaluate(fn, ...args) instead');
  }
  return wrapForEval(input);
}
