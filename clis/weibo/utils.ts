/**
 * Shared Weibo utilities — uid extraction.
 */

import type { IPage } from '@jackwener/opencli/types';
import { AuthRequiredError } from '@jackwener/opencli/errors';

/** Get the currently logged-in user's uid from Vue store or config API. */
export async function getSelfUid(page: IPage): Promise<string> {
  const uid = await page.evaluate(`
    (() => {
      const app = document.querySelector('#app')?.__vue_app__;
      const store = app?.config?.globalProperties?.$store;
      const uid = store?.state?.config?.config?.uid;
      if (uid) return String(uid);
      return null;
    })()
  `);
  if (uid) return uid as string;

  // Fallback: config API
  const config = await page.evaluate(`
    (async () => {
      const resp = await fetch('/ajax/config/get_config', {credentials: 'include'});
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.ok && data.data?.uid ? String(data.data.uid) : null;
    })()
  `);
  if (config) return config as string;
  throw new AuthRequiredError('weibo.com');
}
