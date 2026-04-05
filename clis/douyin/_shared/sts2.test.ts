import { describe, expect, it } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { getSts2Credentials } from './sts2.js';

describe('douyin sts2 credentials', () => {
  it('accepts top-level credential fields returned by creator center', async () => {
    const page = {
      evaluate: async () => ({
        access_key_id: 'ak',
        secret_access_key: 'sk',
        session_token: 'token',
        expired_time: 1_234_567_890,
      }),
    };

    await expect(getSts2Credentials(page as never)).resolves.toEqual({
      access_key_id: 'ak',
      secret_access_key: 'sk',
      session_token: 'token',
      expired_time: 1_234_567_890,
    });
  });

  it('still rejects responses without credential fields', async () => {
    const page = {
      evaluate: async () => ({ status_code: 8 }),
    };

    await expect(getSts2Credentials(page as never)).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
