import { cli } from '@woosau/opencli/registry';
import { createRankingCliOptions } from './rankings.js';
cli(createRankingCliOptions({
    commandName: 'new-releases',
    access: 'read',
    listType: 'new_releases',
    description: 'Amazon New Releases pages for early momentum discovery',
}));
