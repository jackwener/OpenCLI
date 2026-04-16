import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { MAYBEAI_IMAGE_MODELS, type MaybeAiImageModel } from './profiles.js';
import { getMaybeAiImageModelProfile, listMaybeAiImageModelProfiles } from './model-profiles.js';

cli({
  site: 'maybeai-image-app',
  name: 'models',
  description: 'Show MaybeAI image model priority and official supported aspect ratios',
  strategy: Strategy.PUBLIC,
  browser: false,
  defaultFormat: 'json',
  args: [
    {
      name: 'model',
      positional: true,
      required: false,
      choices: [...MAYBEAI_IMAGE_MODELS],
      help: 'Image model to inspect',
    },
  ],
  func: async (_page, kwargs) => {
    if (typeof kwargs.model === 'string') {
      const model = kwargs.model as MaybeAiImageModel;
      if (!MAYBEAI_IMAGE_MODELS.includes(model)) {
        throw new ArgumentError(
          `Invalid model: ${model}`,
          `Allowed model values: ${MAYBEAI_IMAGE_MODELS.join(', ')}`,
        );
      }
      return getMaybeAiImageModelProfile(model);
    }
    return listMaybeAiImageModelProfiles();
  },
});
