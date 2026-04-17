import { cli } from '@jackwener/opencli/registry';
import { createRankingCliOptions } from './rankings.js';
cli(createRankingCliOptions({
    commandName: 'bestsellers',
    listType: 'bestsellers',
    description: 'Amazon Best Sellers pages for category candidate discovery',
}));
