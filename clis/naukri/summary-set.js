import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireText, setTextSection } from './shared.js';

const MAX_SUMMARY_LENGTH = 1000;

cli({
  site: 'naukri',
  name: 'summary-set',
  access: 'write',
  description: 'Update the logged-in Naukri profile summary and verify it was saved',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'text', type: 'string', required: true, help: 'New profile summary text' },
  ],
  columns: ['status', 'profile_summary'],
  func: async (page, kwargs) => {
    const text = requireText(kwargs.text, 'text', MAX_SUMMARY_LENGTH);
    const result = await setTextSection(page, 'Profile summary', text, 'profile_summary');
    return [{ status: 'updated', profile_summary: result.actual }];
  },
});

export const __test__ = {
  MAX_SUMMARY_LENGTH,
};
