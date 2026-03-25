import type { RequiredEnv } from '../../registry.js';

export const chatwiseRequiredEnv: RequiredEnv[] = [
  {
    name: 'OPENCLI_CDP_ENDPOINT',
    help: 'Launch ChatWise with --remote-debugging-port=9228, then run OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9228 opencli chatwise status. If you use a local proxy, also set NO_PROXY=127.0.0.1,localhost.',
  },
];
