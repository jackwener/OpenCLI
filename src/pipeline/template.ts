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
  const fullMatch = template.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  if (fullMatch) return evalExpr(fullMatch[1].trim(), ctx);
  return template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_m, expr) => String(evalExpr(expr.trim(), ctx)));
}

export function evalExpr(expr: string, ctx: RenderContext): any {
  const args = ctx.args ?? {};
  const item = ctx.item ?? {};
  const data = ctx.data;
  const index = ctx.index ?? 0;

  // Default filter: args.limit | default(20)
  if (expr.includes('|') && expr.includes('default(')) {
    const [mainExpr, rest] = expr.split('|', 2);
    const defaultMatch = rest.match(/default\((.+?)\)/);
    const defaultVal = defaultMatch ? defaultMatch[1] : null;
    const result = resolvePath(mainExpr.trim(), { args, item, data, index });
    if (result === null || result === undefined) {
      if (defaultVal !== null) {
        const intVal = parseInt(defaultVal!, 10);
        if (!isNaN(intVal) && String(intVal) === defaultVal!.trim()) return intVal;
        return defaultVal!.replace(/^['"]|['"]$/g, '');
      }
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

  return resolvePath(expr, { args, item, data, index });
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
