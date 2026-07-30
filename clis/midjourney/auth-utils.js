import { AuthRequiredError } from '@jackwener/opencli/errors';
import {
  MIDJOURNEY_DOMAIN,
  MIDJOURNEY_IMAGINE_URL,
  getMidjourneyAccount,
} from './utils.js';

async function onMidjourneyOrigin(page) {
  const hostname = await page.evaluate(() => location.hostname).catch(() => '');
  return hostname === MIDJOURNEY_DOMAIN;
}

export async function midjourneyIdentity(page) {
  if (!await onMidjourneyOrigin(page)) {
    throw new AuthRequiredError(MIDJOURNEY_DOMAIN, 'The browser is not on an authenticated Midjourney page.');
  }
  const account = await getMidjourneyAccount(page);
  return {
    logged_in: true,
    site: 'midjourney',
    plan: account.plan?.type || null,
    subscription_status: account.status || null,
  };
}

export async function midjourneyQuickCheck(page) {
  try {
    await page.goto(MIDJOURNEY_IMAGINE_URL);
    return await midjourneyIdentity(page);
  } catch (error) {
    if (error instanceof AuthRequiredError) return { logged_in: false };
    throw error;
  }
}
