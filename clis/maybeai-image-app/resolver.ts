import { CliError } from '@jackwener/opencli/errors';
import { getApp, toWorkflowVariables, type AppDefinition } from './catalog.js';
import { assertModelSupportsRatio, getModelProfile, selectDefaultModelForRatio } from './model-profiles.js';
import { getPlatformRule } from './platform-profiles.js';
import { IMAGE_KINDS, PLATFORMS, validateOption } from './profiles.js';

export const APP_IMAGE_KIND: Record<string, string> = {
  'try-on': 'model',
  'change-model': 'model',
  'mix-match': 'model',
  'change-action': 'model',
  'change-product': 'scene',
  'change-background': 'scene',
  'gen-main': 'main',
  'replica-listing-image': 'main',
  'gen-scene': 'scene',
  'gen-details': 'detail',
  'details-selling-points': 'detail',
  'add-selling-points': 'detail',
  'gen-multi-angles': 'multi-angle',
  'gen-size-compare': 'detail',
  'gen-reference': 'edit',
  'creative-image-generation': 'social',
  'pattern-extraction': 'edit',
  'pattern-fission': 'edit',
  'scene-fission': 'scene',
  '3d-from-2d': 'edit',
  'product-modification': 'edit',
  'change-color': 'edit',
  'remove-background': 'main',
  'remove-watermark': 'edit',
  'remove-face': 'edit',
};

type AppPolicy = {
  platformDefaults?: boolean;
  fixedDefaults?: Record<string, string>;
  lockedFields?: string[];
  defaultEngine?: string;
};

const APP_POLICIES: Record<string, AppPolicy> = {
  'replica-listing-image': { defaultEngine: 'google/gemini-3-pro-image-preview' },
  'pattern-extraction': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' }, lockedFields: ['engine'] },
  'pattern-fission': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' }, lockedFields: ['engine'] },
  'scene-fission': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' }, lockedFields: ['engine'] },
  '3d-from-2d': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' }, lockedFields: ['engine'] },
  'product-modification': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' }, lockedFields: ['engine'] },
  'change-color': { platformDefaults: false },
  'remove-background': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' }, lockedFields: ['engine'] },
  'remove-watermark': { platformDefaults: false, fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' }, lockedFields: ['engine'] },
  'remove-face': { platformDefaults: false },
};

export function inferImageKind(appId: string): string {
  return APP_IMAGE_KIND[appId] ?? 'edit';
}

export function resolveImageAppInput(appId: string, rawInput: Record<string, unknown>) {
  const app = getApp(appId);
  const warnings: string[] = [];
  const appliedDefaults: Record<string, unknown> = {};
  const inputData = normalizeAliases(rawInput);
  const imageKind = resolveImageKind(app.id, inputData);
  const appPolicy = APP_POLICIES[app.id] ?? {};
  const platform = resolvePlatform(inputData);
  const platformRule = platform ? getPlatformRule(platform) : undefined;
  const canApplyPlatformDefaults = !!platformRule && appPolicy.platformDefaults !== false;

  delete inputData.kind;
  delete inputData.imageKind;

  if (!hasField(app, 'platform') && inputData.platform !== undefined) {
    delete inputData.platform;
    warnings.push('platform is used for API adaptation only; this Shell app has no platform backend field.');
  }

  applyFixedDefaults(app, inputData, appPolicy, appliedDefaults);

  if (canApplyPlatformDefaults && platformRule) applyPlatformDefaults(app, inputData, imageKind, platformRule, appliedDefaults, warnings);
  else if (platformRule && appPolicy.platformDefaults === false) warnings.push(`${app.id} keeps Shell app defaults; platform ratio defaults were not applied.`);

  const resolvedRatio = readRatio(inputData.ratio);
  const engine = resolveEngine(app, inputData, appPolicy, resolvedRatio, appliedDefaults);
  if (engine) assertModelSupportsRatio(engine, resolvedRatio);

  if (hasField(app, 'angles') && inputData.angles === undefined) {
    const angles = platformRule?.defaultAngles ?? ['Frontal', 'Lateral', 'Posterior'];
    inputData.angles = angles;
    appliedDefaults.angles = angles;
  }

  const variables = toWorkflowVariables(app, inputData);
  const outputRatio = resolvedRatio ?? (canApplyPlatformDefaults && platformRule ? platformRule.defaultRatio : undefined);
  const modelProfile = engine ? (() => {
    const profile = getModelProfile(engine);
    return { model: engine, priority: profile.priority, supportedRatios: profile.supportedRatios };
  })() : null;
  const platformProfile = platformRule && outputRatio ? {
    platform: platformRule.platform,
    defaultRatio: platformRule.defaultRatio,
    ratio: outputRatio,
    allowedRatios: platformRule.allowedRatios,
    resolution: String(inputData.resolution ?? platformRule.defaultResolution),
    sourceConfidence: [...new Set(platformRule.sources.map(source => source.confidence))].sort(),
    notes: platformRule.notes,
  } : null;

  return {
    app: app.id,
    title: app.title,
    imageKind,
    input: inputData,
    appliedDefaults,
    modelProfile,
    platformProfile,
    warnings,
    variables,
    outputSchema: app.output,
  };
}

function normalizeAliases(rawInput: Record<string, unknown>) {
  const inputData = { ...rawInput };
  if (inputData.engine === undefined && inputData.model !== undefined) inputData.engine = inputData.model;
  if (inputData.template === undefined && inputData.reference_image_template !== undefined) inputData.template = inputData.reference_image_template;
  if (inputData.prompt === undefined && inputData.product_description !== undefined) inputData.prompt = inputData.product_description;
  if (inputData.reference_images === undefined && inputData.reference_image_url !== undefined) inputData.reference_images = inputData.reference_image_url;
  if (inputData.product_images === undefined && inputData.product_image_url !== undefined && Array.isArray(inputData.product_image_url)) inputData.product_images = inputData.product_image_url;
  if (inputData.image_group_type === undefined && inputData.imageGroupType !== undefined) inputData.image_group_type = inputData.imageGroupType;
  delete inputData.model;
  delete inputData.reference_image_template;
  delete inputData.product_description;
  delete inputData.reference_image_url;
  delete inputData.product_image_url;
  delete inputData.imageGroupType;
  return inputData;
}

function resolveImageKind(appId: string, inputData: Record<string, unknown>) {
  if (appId === 'replica-listing-image') {
    const groupType = inputData.image_group_type;
    if (groupType === 'Detail') return 'detail';
    if (groupType === 'Listing' || groupType === undefined || groupType === '') return 'main';
  }
  const rawKind = (inputData.imageKind ?? inputData.kind) as string | undefined;
  if (!rawKind) return inferImageKind(appId);
  if (typeof rawKind !== 'string' || !IMAGE_KINDS.includes(rawKind as never)) {
    throw new CliError('ARGUMENT', `Invalid image kind: ${String(rawKind)}`, `Allowed image kinds: ${IMAGE_KINDS.join(', ')}`);
  }
  return rawKind;
}

function resolvePlatform(inputData: Record<string, unknown>): string | undefined {
  const rawPlatform = inputData.platform;
  if (rawPlatform === undefined || rawPlatform === '') return undefined;
  if (typeof rawPlatform !== 'string' || !PLATFORMS.includes(rawPlatform as never)) validateOption('platform', rawPlatform, 'platform');
  return rawPlatform as string;
}

function applyPlatformDefaults(app: AppDefinition, inputData: Record<string, unknown>, imageKind: string, rule: ReturnType<typeof getPlatformRule>, appliedDefaults: Record<string, unknown>, warnings: string[]) {
  if (hasField(app, 'ratio')) {
    if (inputData.ratio === undefined || inputData.ratio === '' || inputData.ratio === 'auto') {
      const ratio = rule.ratiosByKind[imageKind as keyof typeof rule.ratiosByKind] ?? rule.defaultRatio;
      inputData.ratio = ratio;
      appliedDefaults.ratio = ratio;
    } else {
      const ratio = readRatio(inputData.ratio);
      if (ratio && !rule.allowedRatios.includes(ratio as never)) warnings.push(`${rule.platform} ${imageKind} usually uses: ${rule.allowedRatios.join(', ')}; received ${ratio}.`);
    }
  }

  if (hasField(app, 'resolution') && (inputData.resolution === undefined || inputData.resolution === '')) {
    inputData.resolution = rule.defaultResolution;
    appliedDefaults.resolution = rule.defaultResolution;
  }
}

function applyFixedDefaults(app: AppDefinition, inputData: Record<string, unknown>, policy: AppPolicy, appliedDefaults: Record<string, unknown>) {
  const fixedDefaults = (policy.fixedDefaults ?? {}) as Record<string, string>;
  const lockedFields = (policy.lockedFields ?? []) as string[];
  for (const [field, defaultValue] of Object.entries(fixedDefaults)) {
    if (!hasField(app, field)) continue;
    const currentValue = inputData[field];
    if (currentValue === undefined || currentValue === '') {
      inputData[field] = defaultValue;
      appliedDefaults[field] = defaultValue;
      continue;
    }
    if (lockedFields.includes(field) && currentValue !== defaultValue) {
      throw new CliError('ARGUMENT', `${app.id} has fixed ${field}: ${defaultValue}`, `Remove ${field} from input or use ${field}=${defaultValue}.`);
    }
  }
}

function resolveEngine(app: AppDefinition, inputData: Record<string, unknown>, policy: AppPolicy, ratio: string | undefined, appliedDefaults: Record<string, unknown>) {
  if (!hasField(app, 'engine')) return undefined;
  const fixedEngine = (policy.fixedDefaults as Record<string, string> | undefined)?.engine;
  const currentEngine = inputData.engine;
  if (fixedEngine) {
    if (currentEngine !== undefined && currentEngine !== '' && currentEngine !== fixedEngine) {
      throw new CliError('ARGUMENT', `${app.id} has fixed engine: ${fixedEngine}`, `This app follows Shell defaults and cannot switch to ${String(currentEngine)}.`);
    }
    inputData.engine = fixedEngine;
    if (currentEngine === undefined || currentEngine === '') appliedDefaults.engine = fixedEngine;
    return fixedEngine;
  }
  if (currentEngine !== undefined && currentEngine !== '') {
    validateOption('model', currentEngine, 'engine');
    return String(currentEngine);
  }
  const engine = policy.defaultEngine ?? selectDefaultModelForRatio(ratio);
  inputData.engine = engine;
  appliedDefaults.engine = engine;
  return engine;
}

function hasField(app: AppDefinition, key: string) {
  return app.fields.some(field => field.key === key);
}

function readRatio(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
