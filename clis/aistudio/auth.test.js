import { expect, it } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { verifyAIStudioIdentity } from './auth.js';
import { AISTUDIO_HOME } from './utils.js';

function pageMock({ currentUrl, probe = { ok: true, name: 'Camelia', email: 'camelia@example.com' } }) {
  const navigations = [];
  const page = {
    navigations,
    async getCookies() {
      return [{ name: 'SID', value: 'mock' }];
    },
    async evaluate(fn) {
      const fnStr = String(fn);
      if (fnStr.includes('window.location.href')) return currentUrl;
      if (fnStr.includes('ms-account-switcher') || fnStr.includes('#account-switcher-button')) return probe;
      return null;
    },
    async goto(url) {
      navigations.push(url);
    },
    async wait() {},
  };
  return page;
}

it('identity verification never navigates away from an in-progress Google auth page', async () => {
  const page = pageMock({ currentUrl: 'https://accounts.google.com/signin/oauth' });
  await expect(verifyAIStudioIdentity(page)).rejects.toThrow(AuthRequiredError);
  expect(page.navigations).toEqual([]);
});

it('identity verification does not re-navigate an already-open AI Studio prompts page', async () => {
  const page = pageMock({ currentUrl: 'https://aistudio.google.com/prompts/new_chat' });
  const identity = await verifyAIStudioIdentity(page);
  expect(identity).toEqual({ name: 'Camelia', email: 'camelia@example.com' });
  expect(page.navigations).toEqual([]);
});

it('identity verification navigates to AI Studio only when the page is somewhere else entirely', async () => {
  const page = pageMock({ currentUrl: 'https://example.com/somewhere' });
  const identity = await verifyAIStudioIdentity(page);
  expect(identity).toEqual({ name: 'Camelia', email: 'camelia@example.com' });
  expect(page.navigations).toEqual([AISTUDIO_HOME]);
});
