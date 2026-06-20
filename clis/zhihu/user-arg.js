import { CliError } from '@jackwener/opencli/errors';

const SLUG_RE = /^[A-Za-z0-9_-]+$/;
const USER_PREFIX_RE = /^user:([A-Za-z0-9_-]+)$/;
const PEOPLE_PATH_RE = /^\/people\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Parse a Zhihu user identifier for read commands.
 * Accepts a bare url_token (`wen-jie-16-47`), the `user:<slug>` form, or a
 * full people URL (`https://www.zhihu.com/people/<slug>`). Returns the slug.
 */
export function parseZhihuUser(input) {
  const value = String(input ?? '').trim();
  if (!value) {
    throw new CliError('INVALID_INPUT', 'A Zhihu user is required', 'Example: opencli zhihu user wen-jie-16-47');
  }
  const prefixMatch = value.match(USER_PREFIX_RE);
  if (prefixMatch) return prefixMatch[1];
  if (SLUG_RE.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'www.zhihu.com') {
      const m = url.pathname.match(PEOPLE_PATH_RE);
      if (m) return m[1];
    }
  } catch {
    // fall through to the typed error below
  }
  throw new CliError(
    'INVALID_INPUT',
    `Invalid Zhihu user: ${value}`,
    'Use a url_token (wen-jie-16-47) or a people URL (https://www.zhihu.com/people/wen-jie-16-47)',
  );
}
