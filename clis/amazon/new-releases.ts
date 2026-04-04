import { cli } from '../../registry.js';
import { createRankingCliOptions } from './rankings.js';

cli(createRankingCliOptions({
  commandName: 'new-releases',
  listType: 'new_releases',
  description: 'Amazon New Releases pages for early momentum discovery',
}));
