import type { IPage } from '../../../types.js';
import type { Sts2Credentials } from './types.js';
import { AuthRequiredError } from '../../../errors.js';

const STS2_URL =
  'https://creator.douyin.com/aweme/mid/video/sts2/?scene=web&aid=1128&cookie_enabled=true&device_platform=web';

/**
 * Fetch STS2 temporary credentials from the creator center.
 * These are used to authenticate Node.js-side TOS multipart uploads.
 * Returns: { access_key_id, secret_access_key, session_token, expired_time }
 */
export async function getSts2Credentials(page: IPage): Promise<Sts2Credentials> {
  const js = `fetch(${JSON.stringify(STS2_URL)}, { credentials: 'include' }).then(r => r.json())`;
  const res = await page.evaluate(js) as Sts2Credentials | { data?: Sts2Credentials };
  const credentials = (
    typeof res === 'object' &&
    res !== null &&
    'data' in res &&
    res.data
  )
    ? res.data
    : (res as Sts2Credentials);
  if (!credentials?.access_key_id) {
    throw new AuthRequiredError('creator.douyin.com', 'STS2 credentials missing');
  }
  return credentials;
}
