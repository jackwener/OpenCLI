import { cli, Strategy } from '@jackwener/opencli/registry';
import { AISTUDIO_DOMAIN, AISTUDIO_HOME, getAIStudioPageState, waitForAIStudioState } from './utils.js';

export const statusCommand = cli({
  site: 'aistudio',
  name: 'status',
  access: 'read',
  description: 'Check Google AI Studio availability, authentication, and selected model',
  domain: AISTUDIO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  args: [],
  columns: ['Status', 'Login', 'Model', 'Url'],
  func: async (page) => {
    let state = await getAIStudioPageState(page).catch(() => null);
    if (!state?.url?.includes(AISTUDIO_DOMAIN)) {
      await page.goto(AISTUDIO_HOME, { waitUntil: 'load' });
      state = await waitForAIStudioState(
        page,
        'AI Studio status page readiness',
        () => getAIStudioPageState(page),
        (current) => !!current?.url?.includes(AISTUDIO_DOMAIN) && (current.hasComposer || current.signInVisible),
        {
          timeoutSeconds: 15,
          pollSeconds: 0.2,
          timeoutMessage: 'Google AI Studio did not become ready for status inspection.',
        },
      );
    }
    return [{
      Status: state.hasComposer ? 'Connected' : 'Page not ready',
      Login: state.signedIn ? 'Yes' : 'No',
      Model: state.currentModel,
      Url: state.url,
    }];
  },
});
