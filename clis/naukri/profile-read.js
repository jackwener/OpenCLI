import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  ensureProfilePage,
  parseNaukriProfileText,
  parseResumeSection,
  PROFILE_COLUMNS,
  readProfile,
  normalizeWhitespace,
} from './shared.js';

cli({
  site: 'naukri',
  name: 'profile-read',
  access: 'read',
  description: 'Read the logged-in Naukri jobseeker profile sections from Mynaukri',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: PROFILE_COLUMNS,
  func: async (page) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri profile-read');
    await ensureProfilePage(page);
    return [await readProfile(page)];
  },
});

export { PROFILE_COLUMNS } from './shared.js';

export const __test__ = {
  normalizeWhitespace,
  parseResumeSection,
  parseNaukriProfileText,
};
