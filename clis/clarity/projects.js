import { cli, Strategy } from '@jackwener/opencli/registry';
import { discoverProjects } from './_ui.js';

export const projectsCommand = cli({
  site: 'clarity',
  name: 'projects',
  access: 'read',
  description: 'List every Microsoft Clarity project this account can see, with its project id — the id `clarity integrations` and `clarity audit` take.',
  example: 'opencli clarity projects -f json',
  domain: 'clarity.microsoft.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'ephemeral',
  navigateBefore: false,
  args: [],
  columns: ['ProjectId', 'Name', 'Site'],
  func: async (page) => discoverProjects(page),
});
