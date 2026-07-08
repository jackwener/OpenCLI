import { cli, Strategy } from '@jackwener/opencli/registry';
import { getApp } from './catalog.js';
import { resolveVideoAppInput } from './resolver.js';
import { getWorkflowProfile } from './workflow-profiles.js';
import { INPUT_ARGS, readJsonObjectInput } from '../maybeai/shared/options.js';

cli({
  site: 'maybeai-video-app',
  name: 'payload',
  access: 'read',
  description: 'Build local workflow variables and step payload previews for a MaybeAI video app',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    { name: 'app', positional: true, required: true, help: 'MaybeAI video app id, e.g. product-ad-video' },
    ...INPUT_ARGS,
  ],
  func: async (_page, kwargs) => {
    const app = getApp(String(kwargs.app));
    const resolved = resolveVideoAppInput(app.id, readJsonObjectInput(kwargs));
    const workflow = getWorkflowProfile(app.id);
    return {
      app: app.id,
      title: app.title,
      mode: workflow.mode,
      resolvedInput: resolved.input,
      initialVariables: resolved.variables,
      steps: workflow.mode === 'tool-chain'
        ? [
            {
              name: 'script',
              endpoint: '/v1/tool/video/generate',
              mode: 'copy',
              requires: ['product', 'reference_video'],
            },
            {
              name: 'main-image',
              endpoint: '/api/v1/tool/function_call',
              toolId: 'maybe_image_generation__generate_image_from_images',
            },
            {
              name: 'shot-images',
              endpoint: '/api/v1/tool/function_call',
              toolId: 'maybe_image_generation__generate_image_from_images',
            },
            {
              name: 'shot-videos',
              endpoint: '/api/v1/tool/function_call',
              toolId: 'maybe_text2video_generation__generate_video_from_reference_image',
            },
            {
              name: 'concat',
              endpoint: '/api/v1/tool/function_call',
              toolId: 'audio_toolkit__concat_videos',
            },
          ]
        : workflow.mode === 'direct'
        ? [
            {
              name: 'generate-video',
              artifactId: workflow.artifactId,
              variables: resolved.variables,
            },
          ]
        : [
            {
              name: 'storyboard',
              artifactId: workflow.storyboardArtifactId,
              variables: resolved.variables,
            },
            {
              name: 'generate-clips',
              artifactId: workflow.clipArtifactId,
              variablesTemplate: [
                { name: 'variable:scalar:case', source: app.id },
                { name: 'variable:dataframe:input_data', source: 'storyboard output rows' },
                { name: 'variable:scalar:aspect_ratio', source: resolved.input.ratio },
                { name: 'variable:scalar:duration', source: resolved.input.duration },
                { name: 'variable:scalar:llm_model', source: resolved.input.engine },
              ],
            },
            {
              name: 'concat',
              artifactId: workflow.concatArtifactId,
              variablesTemplate: [
                { name: 'variable:scalar:case', source: app.id },
                { name: 'variable:dataframe:input_data', source: 'clip output rows' },
              ],
            },
          ],
      outputSchema: app.output,
    };
  },
});
