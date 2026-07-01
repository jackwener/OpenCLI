import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireText, setTextSection } from './shared.js';

const MAX_HEADLINE_LENGTH = 250;

cli({
  site: 'naukri',
  name: 'headline-set',
  access: 'write',
  description: 'Update the logged-in Naukri resume headline and verify it was saved',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'text', type: 'string', required: true, help: 'New resume headline text' },
  ],
  columns: ['status', 'resume_headline'],
  func: async (page, kwargs) => {
    const text = requireText(kwargs.text, 'text', MAX_HEADLINE_LENGTH);
    const result = await setTextSection(page, 'Resume headline', text, 'resume_headline');
    return [{ status: 'updated', resume_headline: result.actual }];
  },
});

export const __test__ = {
  MAX_HEADLINE_LENGTH,
};
