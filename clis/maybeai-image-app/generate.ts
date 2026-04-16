import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { getMaybeAiGeneratedImageApp } from './catalog.js';
import { readJsonObjectInput, mergeDefinedCliValues } from './input.js';
import { MAYBEAI_IMAGE_KINDS } from './profiles.js';
import { resolveMaybeAiGeneratedImageInput } from './resolver.js';
import { getMaybeAiWorkflowProfile } from './workflow-profiles.js';
import {
  MaybeAiWorkflowClient,
  buildSecondStepVariablesV2,
  extractGeneratedImages,
  readMaybeAiWorkflowClientOptions,
} from './workflow-client.js';

cli({
  site: 'maybeai-image-app',
  name: 'generate',
  description: 'Generate images by running MaybeAI workflows; prompt generation is handled internally',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI app id, e.g. gen-main' },
    { name: 'json', help: 'Inline JSON payload using normalized CLI keys' },
    { name: 'file', help: 'Path to a JSON payload file' },
    { name: 'platform', help: 'Target platform, e.g. Amazon, Shopee, XiaoHongShu' },
    { name: 'image-kind', choices: [...MAYBEAI_IMAGE_KINDS], help: 'Image kind for platform ratio adaptation' },
    { name: 'market', help: 'Target country/region' },
    { name: 'category', help: 'Product category' },
    { name: 'ratio', help: 'Override aspect ratio' },
    { name: 'resolution', help: 'Override resolution' },
    { name: 'engine', help: 'Override Shell image model' },
    { name: 'prompt', help: 'Extra generation requirements' },
    { name: 'task-id', help: 'Optional workflow task id for tracing' },
  ],
  func: async (_page, kwargs) => {
    const appId = String(kwargs.app);
    const app = getMaybeAiGeneratedImageApp(appId);
    const workflow = getMaybeAiWorkflowProfile(appId);
    const baseInput = readJsonObjectInput(
      typeof kwargs.file === 'string' ? kwargs.file : undefined,
      typeof kwargs.json === 'string' ? kwargs.json : undefined,
    );
    const input = mergeDefinedCliValues(baseInput, kwargs, [
      'platform',
      'market',
      'category',
      'ratio',
      'resolution',
      'engine',
      'prompt',
    ]);

    if (typeof kwargs['image-kind'] === 'string') {
      input.imageKind = kwargs['image-kind'];
    }

    const resolved = resolveMaybeAiGeneratedImageInput(appId, input);
    const client = new MaybeAiWorkflowClient(readMaybeAiWorkflowClientOptions());
    const taskId = typeof kwargs['task-id'] === 'string' ? kwargs['task-id'] : undefined;

    const rawResults = workflow.mode === 'direct'
      ? await client.run({
        artifactId: workflow.resultArtifactId,
        variables: resolved.variables,
        appId,
        title: app.title,
        taskId,
        service: workflow.service,
      })
      : await runTwoStepWorkflow(client, {
        appId,
        title: app.title,
        taskId,
        promptArtifactId: workflow.promptArtifactId,
        resultArtifactId: workflow.resultArtifactId,
        variables: resolved.variables,
        includeLlmModel: app.fields.some((field) => field.backendVariable === 'variable:scalar:llm_model'),
        service: workflow.service,
      });

    const images = extractGeneratedImages(rawResults, app.output.backendFields);
    if (images.length === 0) {
      throw new CliError('EMPTY_RESULT', 'Workflow completed but no generated image URL was found', JSON.stringify(rawResults).slice(0, 1000));
    }

    return {
      app: app.id,
      title: app.title,
      mode: workflow.mode,
      images,
      resolvedInput: resolved.input,
      modelProfile: resolved.modelProfile,
      warnings: resolved.warnings,
    };
  },
});

async function runTwoStepWorkflow(
  client: MaybeAiWorkflowClient,
  options: {
    appId: string;
    title: string;
    taskId?: string;
    promptArtifactId: string;
    resultArtifactId: string;
    variables: Array<{ name: string; default_value: unknown }>;
    includeLlmModel: boolean;
    service: string;
  },
): Promise<unknown[]> {
  const promptTaskId = crypto.randomUUID();
  const promptConfigs = await client.run({
    artifactId: options.promptArtifactId,
    variables: options.variables,
    appId: options.appId,
    title: options.title,
    taskId: promptTaskId,
    useSystemAuth: true,
    service: options.service,
  });

  const secondStepVariables = buildSecondStepVariablesV2(
    promptConfigs.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)),
    options.variables,
    options.appId,
    options.includeLlmModel,
  );

  return client.run({
    artifactId: options.resultArtifactId,
    variables: secondStepVariables,
    appId: options.appId,
    title: options.title,
    taskId: options.taskId,
    prevTaskId: promptTaskId,
    service: options.service,
  });
}
