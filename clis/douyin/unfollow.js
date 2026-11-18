import { cli } from '@jackwener/opencli/registry';
import { followOptions } from './_shared/follow-write.js';
export const command = cli({ ...followOptions('unfollow'), site: 'douyin', name: 'unfollow' });
