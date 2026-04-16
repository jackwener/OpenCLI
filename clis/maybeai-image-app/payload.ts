import { cli, Strategy } from '@jackwener/opencli/registry';
import { getMaybeAiGeneratedImageApp, toWorkflowVariables } from './catalog.js';
import { readJsonObjectInput } from './input.js';

cli({
  site: 'maybeai-image-app',
  name: 'payload',
  description: 'Build workflow variables from normalized MaybeAI generated-image CLI input',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    { name: 'json', help: 'Inline JSON payload using normalized CLI keys' },
    { name: 'file', help: 'Path to a JSON payload file' },
  ],
  func: async (_page, kwargs) => {
    const app = getMaybeAiGeneratedImageApp(String(kwargs.app));
    const input = readJsonObjectInput(
      typeof kwargs.file === 'string' ? kwargs.file : undefined,
      typeof kwargs.json === 'string' ? kwargs.json : undefined,
    );

    return {
      app: app.id,
      title: app.title,
      variables: toWorkflowVariables(app, input),
      outputSchema: app.output,
    };
  },
});
