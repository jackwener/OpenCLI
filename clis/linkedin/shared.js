import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const LINKEDIN_DOMAIN = 'www.linkedin.com';

export function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeHttpUrl(value, base) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    const parsed = base ? new URL(raw, base) : new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function compactRepeatedText(value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length % 2 === 0) {
    const half = text.length / 2;
    const left = text.slice(0, half);
    if (left === text.slice(half)) return left;
  }
  const words = text.split(' ');
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(' ');
    if (left === words.slice(half).join(' ')) return left;
  }
  return text;
}

export function looksLinkedInAuthWall(value) {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) return false;
  return /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(text)
    || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(text)
    || /(请登录|登录领英|安全验证)/.test(text);
}

export function assertSafeLinkedinUrl(value, label, fallbackPath = '/') {
  const raw = normalizeWhitespace(value || `https://www.linkedin.com${fallbackPath}`);
  let parsed;
  try {
    parsed = new URL(raw, 'https://www.linkedin.com');
  } catch {
    throw new ArgumentError(`${label} must be a LinkedIn URL`);
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new ArgumentError(`${label} must be an https LinkedIn URL without credentials or port`);
  }
  if (host !== 'linkedin.com' && host !== 'www.linkedin.com') {
    throw new ArgumentError(`${label} must point to linkedin.com`);
  }
  return parsed.toString();
}

export function requireStringArg(args, key, label = key) {
  const value = normalizeWhitespace(args?.[key]);
  if (!value) throw new ArgumentError(`${label} is required`);
  return value;
}

export function parseLimit(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export async function requireLinkedInCookie(page, context) {
  let cookies;
  try {
    cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
  } catch (error) {
    throw new CommandExecutionError(`LinkedIn cookie lookup failed: ${error?.message || error}`);
  }
  if (!Array.isArray(cookies)) {
    throw new CommandExecutionError('LinkedIn cookie lookup returned malformed payload');
  }
  const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
  if (!jsession) {
    throw new AuthRequiredError(LINKEDIN_DOMAIN, `${context} requires an active signed-in LinkedIn browser session.`);
  }
  return jsession.replace(/^"|"$/g, '');
}

export function buildAuthProbeScript() {
  return String.raw`(() => {
    const text = [
      window.location.href || '',
      document.title || '',
      document.body ? (document.body.innerText || '').slice(0, 4000) : '',
    ].join('\n');
    return /linkedin\.com\/(?:login|checkpoint|authwall|uas)/i.test(text)
      || /\b(sign in|log in|join linkedin|captcha|verification required)\b/i.test(text)
      || /(请登录|登录领英|安全验证)/.test(text);
  })()`;
}

export async function assertLinkedInAuthenticated(page, context) {
  const authRequired = unwrapEvaluateResult(await page.evaluate(buildAuthProbeScript()));
  if (authRequired) {
    throw new AuthRequiredError(LINKEDIN_DOMAIN, `${context} requires an active signed-in LinkedIn browser session.`);
  }
}

export function splitVisibleLines(text) {
  return String(text || '').split(/\n+/).map(normalizeWhitespace).filter(Boolean);
}
