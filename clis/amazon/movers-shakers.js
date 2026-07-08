import { cli } from '@jackwener/opencli/registry';
import { createRankingCliOptions } from './rankings.js';
cli(createRankingCliOptions({
    commandName: 'movers-shakers',
    access: 'read',
    listType: 'movers_shakers',
    description: 'Amazon Movers & Shakers pages for short-term growth signals',
}));
