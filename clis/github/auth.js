import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasGithubSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://github.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('user_session') || names.has('dotcom_user') || names.has('logged_in');
}

async function verifyGithubIdentity(page) {
  await page.goto('https://github.com/settings/profile');
  await page.wait(1);
  const identity = await page.evaluate(`() => {
    const meta = (name) => document.querySelector('meta[name="' + name + '"]')?.getAttribute('content') || '';
    const username = meta('octolytics-actor-login');
    const id = meta('octolytics-actor-id');
    const name = document.querySelector('input#user_profile_name')?.value || '';
    return { username, id, name, url: location.href };
  }`);
  if (!identity?.username || /\/login(?:\?|$)/.test(String(identity?.url ?? ''))) {
    throw new AuthRequiredError('github.com', 'Could not detect a logged-in GitHub account');
  }
  return {
    id: identity.id || '',
    username: identity.username,
    name: identity.name || '',
    url: `https://github.com/${identity.username}`,
  };
}

registerSiteAuthCommands({
  site: 'github',
  domain: 'github.com',
  loginUrl: 'https://github.com/login',
  columns: ['id', 'username', 'name', 'url'],
  quickCheck: hasGithubSessionCookies,
  verify: verifyGithubIdentity,
  poll: async (page) => {
    if (!await hasGithubSessionCookies(page)) {
      throw new AuthRequiredError('github.com', 'Waiting for GitHub session cookies');
    }
    return verifyGithubIdentity(page);
  },
});
