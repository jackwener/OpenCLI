import { cli, Strategy } from '@jackwener/opencli/registry';
import { detailFor, gotoClaritySettings, normalizeProjectId, readIntegrationCards } from './_ui.js';

export const integrationsCommand = cli({
  site: 'clarity',
  name: 'integrations',
  access: 'read',
  description: 'Read Microsoft Clarity Setup-tab integration status (GTM, Google Analytics, Google Ads, Microsoft Ads) for one project. Read-only; never connects or disconnects anything.',
  example: 'opencli clarity integrations a1b2c3d4e5 -f json',
  domain: 'clarity.microsoft.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'ephemeral',
  navigateBefore: false,
  args: [
    { name: 'project-id', type: 'string', required: true, positional: true, help: 'Clarity project id, e.g. a1b2c3d4e5 (from the /projects/view/<id>/ URL).' },
  ],
  columns: ['Project', 'Integration', 'Status', 'Detail'],
  func: async (page, kwargs) => {
    const projectId = normalizeProjectId(kwargs['project-id']);
    await gotoClaritySettings(page, projectId, 'setup', 'Clarity integrations');
    const cards = await readIntegrationCards(page);
    return cards.map((card) => ({
      Project: projectId,
      Integration: card.name,
      Status: card.status,
      Detail: detailFor(card),
    }));
  },
});
