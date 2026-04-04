import { cli } from '../../src/registry.js';
import { createRankingCliOptions } from './rankings.js';

cli(createRankingCliOptions({
  commandName: 'bestsellers',
  listType: 'bestsellers',
  description: 'Amazon Best Sellers pages for category candidate discovery',
}));
