import { CliError } from '@jackwener/opencli/errors';
import { getApp, toWorkflowVariables, type AppDefinition } from './catalog.js';
import { assertModelSupportsRatio, getModelProfile } from './model-profiles.js';
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
  'gen-image-set': 'main',
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

export function inferImageKind(appId: string): string {
  return APP_IMAGE_KIND[appId] ?? 'edit';
}

export function resolveImageAppInput(appId: string, rawInput: Record<string, unknown>) {
  const app = getApp(appId);
  const warnings: string[] = [];
  const appliedDefaults: Record<string, unknown> = {};
  const inputData = normalizeAliases(rawInput);
  const imageKind = resolveImageKind(app.id, inputData);
  const platform = resolvePlatform(inputData);
  const platformRule = platform ? getPlatformRule(platform) : undefined;

  delete inputData.kind;
  delete inputData.imageKind;

  canonicalizeAppInput(app.id, inputData);

  if (!hasField(app, 'platform') && inputData.platform !== undefined) {
    delete inputData.platform;
    warnings.push('platform is used for API adaptation only; this Shell app has no platform backend field.');
  }

  const resolvedRatio = readRatio(inputData.ratio);
  if (platformRule && resolvedRatio && !platformRule.allowedRatios.includes(resolvedRatio as never)) {
    warnings.push(`${platformRule.platform} ${imageKind} usually uses: ${platformRule.allowedRatios.join(', ')}; received ${resolvedRatio}.`);
  }

  const engine = resolveEngine(app, inputData);
  if (engine) assertModelSupportsRatio(engine, resolvedRatio);

  pruneTransientInputKeys(app.id, inputData);
  dropUnsupportedAppKeys(app, inputData, warnings);

  const variables = toWorkflowVariables(app, inputData);
  const modelProfile = engine ? (() => {
    const profile = getModelProfile(engine);
    return { model: engine, priority: profile.priority, supportedRatios: profile.supportedRatios };
  })() : null;
  const platformProfile = platformRule ? {
    platform: platformRule.platform,
    defaultRatio: platformRule.defaultRatio,
    ratio: resolvedRatio,
    allowedRatios: platformRule.allowedRatios,
    resolution: typeof inputData.resolution === 'string' ? inputData.resolution : undefined,
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

function resolveEngine(app: AppDefinition, inputData: Record<string, unknown>) {
  if (!hasField(app, 'engine')) return undefined;
  const currentEngine = inputData.engine;
  if (currentEngine !== undefined && currentEngine !== '') {
    validateOption('model', currentEngine, 'engine');
    return String(currentEngine);
  }
  return undefined;
}

function hasField(app: AppDefinition, key: string) {
  return app.fields.some(field => field.key === key);
}

function readRatio(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function canonicalizeAppInput(appId: string, inputData: Record<string, unknown>) {
  if (usesSingleProduct(appId) && !hasValue(inputData.product)) {
    const product = readStringArray(inputData.products)[0];
    if (product) inputData.product = product;
  }

  if (['gen-details', 'details-selling-points', 'add-selling-points'].includes(appId)) {
    if (!isStructuredImageArray(inputData.product_and_attrs)) {
      const legacy = readLegacyProductAndAttrs(inputData.product_and_attrs);
      if (legacy.product) {
        inputData.product_and_attrs = buildStructuredProductAndAttrs(legacy.product, legacy.attrs);
      }
    }
  }

  if (appId === 'gen-size-compare') {
    if (!isStructuredImageArray(inputData.product_and_size_chart)) {
      const legacy = readLegacyProductAndSizeChart(inputData.product_and_size_chart);
      if (legacy.product && legacy.sizeChart) {
        inputData.product_and_size_chart = buildStructuredProductAndAttrs(legacy.product, [legacy.sizeChart]);
      }
    }
  }
}

function pruneTransientInputKeys(appId: string, inputData: Record<string, unknown>) {
  const keysToDelete = new Set<string>(['kind', 'imageKind']);

  if (['gen-details', 'details-selling-points', 'add-selling-points'].includes(appId)) {
    for (const key of ['product', 'products', 'attrs']) keysToDelete.add(key);
  }

  if (appId === 'replica-listing-image') {
    for (const key of ['product', 'products', 'reference', 'reference-template']) keysToDelete.add(key);
  }

  if (appId === 'gen-reference') {
    for (const key of ['product', 'products', 'reference']) keysToDelete.add(key);
  }

  if (appId === 'gen-size-compare') {
    for (const key of ['product', 'products', 'size-chart']) keysToDelete.add(key);
  }

  for (const key of keysToDelete) delete inputData[key];
}

function dropUnsupportedAppKeys(app: AppDefinition, inputData: Record<string, unknown>, warnings: string[]) {
  const allowedKeys = new Set(app.fields.map(field => field.key));
  const droppedKeys: string[] = [];

  for (const key of Object.keys(inputData)) {
    if (allowedKeys.has(key)) continue;
    droppedKeys.push(key);
    delete inputData[key];
  }

  if (droppedKeys.length > 0) {
    warnings.push(`Dropped unsupported input fields for ${app.id}: ${droppedKeys.sort().join(', ')}`);
  }
}

function buildStructuredProductAndAttrs(product: string, attrs: string[]) {
  return [
    { image_type: 'product_image_url', url: product, description: '商品图片' },
    ...attrs.filter(Boolean).map(url => ({
      image_type: 'product_attribute_url',
      url,
      description: '商品属性图片',
    })),
  ];
}

function readLegacyProductAndAttrs(value: unknown): { product?: string; attrs: string[] } {
  if (!Array.isArray(value)) return { attrs: [] };

  const productCandidates: string[] = [];
  const attrCandidates: string[] = [];

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      if (productCandidates.length === 0) productCandidates.push(item.trim());
      else attrCandidates.push(item.trim());
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.product_image_url === 'string' && record.product_image_url.trim()) {
      productCandidates.push(record.product_image_url.trim());
    }
    if (Array.isArray(record.attr_image_urls)) {
      attrCandidates.push(
        ...record.attr_image_urls
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map(entry => entry.trim()),
      );
    }
  }

  return {
    product: productCandidates[0],
    attrs: [...new Set(attrCandidates)],
  };
}

function readLegacyProductAndSizeChart(value: unknown): { product?: string; sizeChart?: string } {
  if (!Array.isArray(value)) return {};

  const rawUrls = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
  if (rawUrls.length >= 2) return { product: rawUrls[0], sizeChart: rawUrls[1] };

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const product = typeof record.product_image_url === 'string' && record.product_image_url.trim()
      ? record.product_image_url.trim()
      : undefined;
    const sizeChart = typeof record.reference_image_url === 'string' && record.reference_image_url.trim()
      ? record.reference_image_url.trim()
      : undefined;
    if (product && sizeChart) return { product, sizeChart };
  }

  return {};
}

function isStructuredImageArray(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item =>
      !!item
      && typeof item === 'object'
      && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).image_type === 'string'
      && typeof (item as Record<string, unknown>).url === 'string');
}

function usesSingleProduct(appId: string): boolean {
  return ['change-action', 'change-background', 'pattern-extraction', 'pattern-fission', 'scene-fission', '3d-from-2d', 'product-modification', 'change-color'].includes(appId);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim());
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}
