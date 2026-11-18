import { cli } from '@jackwener/opencli/registry';
import { followOptions } from './_shared/follow-write.js';
export { buildFollowScript, followRuntime, prepareFollow } from './_shared/follow-write.js';
export const command = cli({ ...followOptions('follow'), site: 'douyin', name: 'follow' });
