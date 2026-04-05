import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { DOUBAO_DOMAIN, getDoubaoVisibleTurns } from './utils.js';

export const readCommand = cli({
  site: 'doubao',
  name: 'read',
  description: 'Read the current Doubao conversation history',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['Role', 'Text'],
  func: async (page: IPage) => {
    const turns = await getDoubaoVisibleTurns(page);
    if (turns.length > 0) return turns;
    return [{ Role: 'System', Text: 'No visible Doubao messages were found.' }];
  },
});
