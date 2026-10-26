import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { readKeySkills } from './shared.js';

cli({
  site: 'naukri',
  name: 'key-skills-list',
  access: 'read',
  description: 'List current logged-in Naukri key skill chips',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['rank', 'skill'],
  func: async (page) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri key-skills-list');
    const skills = await readKeySkills(page);
    return skills.map((skill, index) => ({ rank: index + 1, skill }));
  },
});
