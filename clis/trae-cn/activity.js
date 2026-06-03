import { cli, Strategy } from '@jackwener/opencli/registry';
import { activityScript, normalizeMaxChars } from './utils.js';

export const activityCommand = cli({
  site: 'trae-cn',
  name: 'activity',
  access: 'read',
  description: 'Read the current Trae CN task/activity state, including in-progress steps when visible',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn activity --max-chars 1200 -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars per text field; 0 returns full text (default: 1200)', default: 1200 },
  ],
  columns: ['Status', 'Workspace', 'Model', 'Agent', 'LatestRole', 'TurnIndex', 'MessageId', 'Progress', 'ActiveStep', 'CompletedSteps', 'PendingSteps', 'TotalSteps', 'ApprovalPending', 'ApprovalKind', 'ApprovalButton', 'Thinking', 'LatestText', 'TextChars', 'UpdatedAt'],
  func: async (page, kwargs) => {
    const maxChars = normalizeMaxChars(kwargs['max-chars'], 1200);
    const activity = await page.evaluate(activityScript(maxChars));
    return [activity];
  },
});
