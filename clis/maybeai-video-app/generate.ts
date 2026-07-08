import { cli, Strategy } from '@jackwener/opencli/registry';
import { addGenerateOptions, INPUT_ARGS, readJsonObjectInput, WORKFLOW_ARGS } from '../maybeai/shared/options.js';
import { executeGenerate } from './engine.js';

const TOOL_CHAIN_ARGS = [
  { name: 'fastest-api-url', help: 'Fastest API URL for video script generation; defaults to MAYBEAI_FASTEST_API_URL or https://api.fastest.ai' },
  { name: 'organization-id', help: 'Optional organization id for Playground tool billing' },
  { name: 'generate-audio', help: 'Generate audio in shot videos when supported' },
];

cli({
  site: 'maybeai-video-app',
  name: 'generate',
  access: 'write',
  description: 'Generate videos with an explicit MaybeAI video app and run workflows directly',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI video app id, e.g. product-ad-video' },
    ...INPUT_ARGS,
    { name: 'task-id', help: 'Optional workflow task id for tracing' },
    { name: 'debug', help: 'Include workflow debug details' },
    ...WORKFLOW_ARGS,
    ...TOOL_CHAIN_ARGS,
  ],
  func: async (_page, kwargs) => executeGenerate(String(kwargs.app), addGenerateOptions({ input: readJsonObjectInput(kwargs) }, kwargs).input as Record<string, unknown>, kwargs, !!kwargs.debug),
});
