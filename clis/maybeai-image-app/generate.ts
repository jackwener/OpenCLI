import { cli, Strategy } from '@jackwener/opencli/registry';
import { API_ARGS, INPUT_ARGS, addGenerateOptions, buildAppBody, maybeAiAppPost } from './common.js';

cli({
  site: 'maybeai-image-app',
  name: 'generate',
  description: 'Generate images with an explicit MaybeAI app via the MaybeAI app API',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    ...INPUT_ARGS,
    { name: 'task-id', help: 'Optional workflow task id for tracing' },
    ...API_ARGS,
  ],
  func: async (_page, kwargs) => {
    const body = addGenerateOptions(buildAppBody(String(kwargs.app), kwargs), kwargs);
    return maybeAiAppPost('/api/v1/image-app/generate', body, kwargs);
  },
});
