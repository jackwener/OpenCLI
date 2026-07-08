import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export function requireSearchQuery(value, label = 'keyword') {
  const query = String(value ?? '').trim();
  if (!query) {
    throw new ArgumentError(`${label} cannot be empty`);
  }
  return query;
}

export function requireBoundedInteger(value, defaultValue, min, max, label) {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ArgumentError(`${label} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  if (parsed < min || parsed > max) {
    throw new ArgumentError(`${label} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

export function requireNonNegativeInteger(value, defaultValue, label) {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ArgumentError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value) {
    return value.data;
  }
  return value;
}

export function requireRows(value, label) {
  const rows = unwrapBrowserResult(value);
  if (!Array.isArray(rows)) {
    throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array of result rows.`);
  }
  return rows;
}

export function toHttpsUrl(value, baseUrl) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

export function emptySearchResults(site, query) {
  return new EmptyResultError(`${site} search`, `No ${site} results matched "${query}".`);
}

export async function runBrowserStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.code || error?.name === 'ArgumentError') throw error;
    throw new CommandExecutionError(`${label} failed: ${error?.message ?? error}`);
  }
}
