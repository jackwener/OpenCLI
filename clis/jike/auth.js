import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { requireJikeIdentity } from './utils.js';

// Jike web (web.okjike.com) is an SPA shell that stores a JWT in localStorage
// under JK_ACCESS_TOKEN and forwards it as the x-jike-access-token header to the
// api.ruguoapp.com gateway. The JWT payload is encrypted, so identity is read
// from the /1.0/users/profile endpoint rather than from the token or a cookie.
async function verifyJikeIdentity(page) {
  await page.goto('https://web.okjike.com/');
  await page.wait(2);
  return requireJikeIdentity(page);
}

registerSiteAuthCommands({
  site: 'jike',
  domain: 'web.okjike.com',
  loginUrl: 'https://web.okjike.com/login',
  columns: ['user_id', 'screen_name', 'username'],
  verify: verifyJikeIdentity,
  poll: async (page) => {
    try {
      return await requireJikeIdentity(page);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        throw new AuthRequiredError('web.okjike.com', 'Waiting for Jike login');
      }
      throw error;
    }
  },
});
