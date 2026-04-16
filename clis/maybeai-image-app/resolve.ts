import { cli, Strategy } from '@jackwener/opencli/registry';
import { readJsonObjectInput, mergeDefinedCliValues } from './input.js';
import { MAYBEAI_IMAGE_KINDS } from './profiles.js';
import { resolveMaybeAiGeneratedImageInput } from './resolver.js';

cli({
  site: 'maybeai-image-app',
  name: 'resolve',
  description: 'Resolve a MaybeAI generated-image app payload with platform-aware defaults before workflow execution',
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
  ],
  func: async (_page, kwargs) => {
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

    return resolveMaybeAiGeneratedImageInput(String(kwargs.app), input);
  },
});
