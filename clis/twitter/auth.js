import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { normalizeTwitterScreenName } from './shared.js';

const SCREEN_NAME_POLL_SECONDS = 1;
const SCREEN_NAME_POLLS = 8;
const SCREEN_NAME_AGREEMENTS = 3;

async function hasTwitterSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://x.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('auth_token') && names.has('ct0');
}

function unwrapTwitterEvaluateResult(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value) {
    if (typeof value.session === 'string' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    throw new CommandExecutionError(`Twitter/X ${label} returned a malformed Browser Bridge envelope`);
  }
  return value;
}

async function readScreenName(page) {
  const href = unwrapTwitterEvaluateResult(await page.evaluate(`() => {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return link ? link.getAttribute('href') : null;
  }`), 'profile link probe');
  if (href !== null && typeof href !== 'string') {
    throw new CommandExecutionError('Twitter/X profile link probe returned a malformed href');
  }
  return normalizeTwitterScreenName(typeof href === 'string' ? href : '');
}

/**
 * Right after an account switch the home surface keeps showing the previous
 * account for a few seconds, so a single read misreports it (#2252); trust
 * the handle only once it holds across three polls.
 */
async function readSettledScreenName(page) {
  const samples = [];
  for (let poll = 0; poll < SCREEN_NAME_POLLS; poll += 1) {
    samples.push(await readScreenName(page));
    if (poll < SCREEN_NAME_POLLS - 1) {
      await page.sleep(SCREEN_NAME_POLL_SECONDS);
    }
  }
  const tail = samples.slice(-SCREEN_NAME_AGREEMENTS);
  const username = tail[0] || '';
  return username && tail.every((sample) => sample === username) ? username : '';
}

async function verifyTwitterIdentity(page, { phase } = {}) {
  if (!await hasTwitterSessionCookies(page)) {
    throw new AuthRequiredError('x.com', 'Twitter/X auth cookies are missing');
  }
  await page.goto('https://x.com/home');
  await page.wait({ selector: '[data-testid="primaryColumn"]' }).catch(() => { });
  // Login polls repeat every ~2s; they keep the single read and skip the #2252 settle loop.
  const username = phase === 'poll'
    ? await readScreenName(page)
    : await readSettledScreenName(page);
  if (!username) {
    throw new AuthRequiredError('x.com', 'Could not detect the logged-in Twitter/X profile link');
  }
  return { username, url: `https://x.com/${username}` };
}

registerSiteAuthCommands({
  site: 'twitter',
  domain: 'x.com',
  loginUrl: 'https://x.com/i/flow/login',
  columns: ['username', 'url'],
  quickCheck: hasTwitterSessionCookies,
  verify: verifyTwitterIdentity,
  poll: async (page, options) => {
    if (!await hasTwitterSessionCookies(page)) {
      throw new AuthRequiredError('x.com', 'Waiting for Twitter/X auth cookies');
    }
    return verifyTwitterIdentity(page, options);
  },
});
