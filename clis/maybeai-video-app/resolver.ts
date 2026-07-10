import { CliError } from '@jackwener/opencli/errors';
import { assertKnownInputFields, getApp } from './catalog.js';
import { getModelProfile, selectDefaultModel } from './model-profiles.js';
import { getPlatformRule } from './platform-profiles.js';
import { validateOption } from './profiles.js';

const DEFAULT_STYLE_BY_APP: Record<string, string> = {
  'video-remake': 'product-demo',
  'product-ad-video': 'product-demo',
  'listing-video': 'listing',
  'ugc-ad-video': 'ugc',
};

export function resolveVideoAppInput(appId: string, rawInput: Record<string, unknown>) {
  const app = getApp(appId);
  const warnings: string[] = [];
  const appliedDefaults: Record<string, unknown> = {};
  const inputData = normalizeAliases(rawInput);
  const platform = resolvePlatform(inputData);
  const platformRule = platform ? getPlatformRule(platform) : undefined;

  if (inputData.market !== undefined) validateOption('country', inputData.market, 'market');
  if (inputData.category !== undefined) validateOption('category', inputData.category, 'category');
  if (inputData.style !== undefined) validateOption('style', inputData.style, 'style');

  if (inputData.ratio === undefined || inputData.ratio === '') {
    const ratio = platformRule?.ratiosByApp[app.id as keyof typeof platformRule.ratiosByApp] ?? (app.id === 'image-to-video' ? '9:16' : '1:1');
    inputData.ratio = ratio;
    appliedDefaults.ratio = ratio;
  } else {
    validateOption('ratio', inputData.ratio, 'ratio');
    if (platformRule && !platformRule.allowedRatios.includes(String(inputData.ratio))) {
      warnings.push(`${platformRule.platform} usually uses: ${platformRule.allowedRatios.join(', ')}; received ${String(inputData.ratio)}.`);
    }
  }

  if (inputData.duration === undefined || inputData.duration === '') {
    const duration = platformRule?.defaultDuration ?? (app.id === 'image-to-video' ? 5 : 15);
    inputData.duration = duration;
    appliedDefaults.duration = duration;
  } else {
    inputData.duration = parsePositiveNumber(inputData.duration, 'duration');
  }

  if (app.id !== 'image-to-video' && inputData.style === undefined && app.id !== 'video-remake') {
    inputData.style = DEFAULT_STYLE_BY_APP[app.id];
    appliedDefaults.style = inputData.style;
  }

  if (inputData.engine === undefined || inputData.engine === '') {
    inputData.engine = selectDefaultModel();
    appliedDefaults.engine = inputData.engine;
  } else {
    validateOption('model', inputData.engine, 'engine');
  }

  assertKnownInputFields(app.id, inputData);
  const variables = buildInitialWorkflowVariables(app.id, inputData);
  const modelProfile = inputData.engine ? getModelProfile(String(inputData.engine)) : null;
  const platformProfile = platformRule ? {
    platform: platformRule.platform,
    defaultRatio: platformRule.defaultRatio,
    ratio: String(inputData.ratio),
    allowedRatios: platformRule.allowedRatios,
    defaultDuration: platformRule.defaultDuration,
    notes: platformRule.notes,
  } : null;

  return {
    app: app.id,
    title: app.title,
    input: inputData,
    appliedDefaults,
    modelProfile,
    platformProfile,
    warnings,
    variables,
    outputSchema: app.output,
  };
}

function buildInitialWorkflowVariables(appId: string, inputData: Record<string, unknown>) {
  if (appId === 'image-to-video') {
    return [
      { name: 'variable:scalar:case', default_value: appId },
      {
        name: 'variable:dataframe:input_data',
        default_value: [{ prompt_split: inputData.prompt, split_images: inputData.image }],
      },
      { name: 'variable:scalar:aspect_ratio', default_value: inputData.ratio },
      { name: 'variable:scalar:duration', default_value: inputData.duration },
      { name: 'variable:scalar:llm_model', default_value: inputData.engine },
    ];
  }

  if (appId === 'video-remake') {
    return [];
  }

  return [
    { name: 'variable:scalar:case', default_value: appId },
    { name: 'variable:scalar:product_image_url', default_value: inputData.product },
    { name: 'variable:scalar:reference_image_url', default_value: inputData.person ?? '' },
    { name: 'variable:scalar:target_market', default_value: inputData.market ?? 'North America' },
    { name: 'variable:scalar:reference_type', default_value: inputData.style ?? DEFAULT_STYLE_BY_APP[appId] ?? 'product-demo' },
    { name: 'variable:scalar:user_description', default_value: inputData.prompt ?? '' },
    { name: 'variable:scalar:aspect_ratio', default_value: inputData.ratio },
    { name: 'variable:scalar:duration', default_value: inputData.duration },
    { name: 'variable:scalar:llm_model', default_value: inputData.engine },
  ];
}

function normalizeAliases(rawInput: Record<string, unknown>) {
  const inputData: Record<string, unknown> = { ...rawInput };

  if (inputData.engine === undefined && inputData.model !== undefined) inputData.engine = inputData.model;
  if (inputData.product === undefined) applyAlias(inputData, 'product', firstArrayValue(inputData.product_images, inputData.productImages, inputData.products));
  if (inputData.person === undefined) applyAlias(inputData, 'person', firstArrayValue(inputData.reference_images, inputData.referenceImages, inputData.people));
  if (inputData.reference_video === undefined) applyAlias(inputData, 'reference_video', firstArrayValue(inputData.reference_videos, inputData.referenceVideos));
  if (inputData.image === undefined) applyAlias(inputData, 'image', firstArrayValue(inputData.images));
  if (inputData.style === undefined && inputData.reference_type !== undefined) inputData.style = inputData.reference_type;

  delete inputData.model;
  delete inputData.product_images;
  delete inputData.productImages;
  delete inputData.products;
  delete inputData.reference_images;
  delete inputData.referenceImages;
  delete inputData.reference_videos;
  delete inputData.referenceVideos;
  delete inputData.reference_type;
  delete inputData.people;
  delete inputData.images;

  return inputData;
}

function applyAlias(inputData: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null && value !== '') inputData[key] = value;
}

function resolvePlatform(inputData: Record<string, unknown>) {
  const rawPlatform = inputData.platform;
  if (rawPlatform === undefined || rawPlatform === '') return undefined;
  validateOption('platform', rawPlatform, 'platform');
  return String(rawPlatform);
}

function parsePositiveNumber(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new CliError('ARGUMENT', `Invalid ${field}: ${String(value)}`, `${field} must be a positive number`);
  return parsed;
}

function firstArrayValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find(item => typeof item === 'string' && item.trim());
      if (typeof first === 'string') return first.trim();
    }
  }
  return undefined;
}
