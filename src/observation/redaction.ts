const DEFAULT_REDACTION = '[REDACTED]';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

const SENSITIVE_FIELD_PATTERN = /(password|passwd|pwd|token|secret|authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?id|csrf|xsrf)/i;
const SENSITIVE_URL_PARAMS = /([?&])(token|key|secret|password|auth|access_token|api_key|session_id|csrf|xsrf)=[^&]*/gi;

export interface RedactionOptions {
  allowlist?: string[];
  maxStringLength?: number;
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectFields?: number;
}

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE_URL_PARAMS, '$1$2=[REDACTED]');
}

export function redactHeaders(headers: Record<string, unknown> | undefined, opts: RedactionOptions = {}): Record<string, unknown> | undefined {
  if (!headers) return headers;
  const allow = new Set((opts.allowlist ?? []).map((key) => key.toLowerCase()));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    out[key] = SENSITIVE_HEADER_NAMES.has(lower) && !allow.has(lower)
      ? DEFAULT_REDACTION
      : redactValue(value, opts, key);
  }
  return out;
}

export function redactText(text: string, opts: RedactionOptions = {}): string {
  const max = opts.maxStringLength ?? 50_000;
  let out = text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(["'])(password|passwd|pwd|token|secret|api_key|apikey|access_token|session_id)\1\s*:\s*(["'])(.*?)\3/gi, '$1$2$1:$3[REDACTED]$3')
    .replace(/(token|secret|password|api_key|apikey|access_token|session_id)[=:]\s*['"]?[^'"\s,;}&]+['"]?/gi, '$1=[REDACTED]')
    .replace(/(cookie[=:]\s*)[^\n;]{3,}/gi, '$1[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
  if (out.length > max) out = out.slice(0, max) + `\n...[truncated, ${out.length - max} chars omitted]`;
  return out;
}

export function redactValue(value: unknown, opts: RedactionOptions = {}, keyHint?: string, depth: number = 0): unknown {
  const allow = new Set((opts.allowlist ?? []).map((key) => key.toLowerCase()));
  if (keyHint && SENSITIVE_FIELD_PATTERN.test(keyHint) && !allow.has(keyHint.toLowerCase())) {
    return DEFAULT_REDACTION;
  }
  if (typeof value === 'string') {
    return keyHint === 'url' ? redactUrl(value) : redactText(value, opts);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;

  const maxDepth = opts.maxDepth ?? 5;
  if (depth >= maxDepth) return '[truncated: max depth reached]';

  if (Array.isArray(value)) {
    const max = opts.maxArrayItems ?? 100;
    const items = value.slice(0, max).map((item) => redactValue(item, opts, undefined, depth + 1));
    if (value.length > max) items.push(`[truncated, ${value.length - max} items omitted]`);
    return items;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const max = opts.maxObjectFields ?? 100;
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries.slice(0, max)) {
      if (key.toLowerCase() === 'url' && typeof child === 'string') out[key] = redactUrl(child);
      else if (key.toLowerCase().includes('headers') && child && typeof child === 'object' && !Array.isArray(child)) {
        out[key] = redactHeaders(child as Record<string, unknown>, opts);
      } else {
        out[key] = redactValue(child, opts, key, depth + 1);
      }
    }
    if (entries.length > max) out.__truncated__ = `[${entries.length - max} fields omitted]`;
    return out;
  }

  return value;
}
