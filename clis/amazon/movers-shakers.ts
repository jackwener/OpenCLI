import { cli } from '../../src/registry.js';
import { createRankingCliOptions } from './rankings.js';

cli(createRankingCliOptions({
  commandName: 'movers-shakers',
  listType: 'movers_shakers',
  description: 'Amazon Movers & Shakers pages for short-term growth signals',
}));
