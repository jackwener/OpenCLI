import { ArgumentError } from '@jackwener/opencli/errors';
import {
  getMaybeAiGeneratedImageApp,
  toWorkflowVariables,
  type MaybeAiGeneratedImageApp,
} from './catalog.js';
import {
  MAYBEAI_IMAGE_KINDS,
  MAYBEAI_PLATFORMS,
  validateMaybeAiOption,
  type MaybeAiAspectRatio,
  type MaybeAiImageKind,
  type MaybeAiImageModel,
  type MaybeAiPlatform,
} from './profiles.js';
import { getMaybeAiPlatformRule, type MaybeAiPlatformRule } from './platform-profiles.js';
import {
  assertMaybeAiModelSupportsRatio,
  getMaybeAiImageModelProfile,
  selectMaybeAiDefaultModelForRatio,
} from './model-profiles.js';

const APP_IMAGE_KIND: Record<string, MaybeAiImageKind> = {
  'try-on': 'model',
  'change-model': 'model',
  'mix-match': 'model',
  'change-action': 'model',
  'change-product': 'scene',
  'change-background': 'scene',
  'gen-main': 'main',
  'gen-scene': 'scene',
  'gen-details': 'detail',
  'details-selling-points': 'detail',
  'add-selling-points': 'detail',
  'gen-multi-angles': 'multi-angle',
  'gen-size-compare': 'detail',
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

interface MaybeAiAppPolicy {
  platformDefaults?: boolean;
  fixedDefaults?: Partial<Record<'engine' | 'ratio' | 'resolution' | 'background', unknown>>;
  lockedFields?: string[];
}

const APP_POLICIES: Record<string, MaybeAiAppPolicy> = {
  'pattern-extraction': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' },
    lockedFields: ['engine'],
  },
  'pattern-fission': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' },
    lockedFields: ['engine'],
  },
  'scene-fission': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' },
    lockedFields: ['engine'],
  },
  '3d-from-2d': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' },
    lockedFields: ['engine'],
  },
  'product-modification': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' },
    lockedFields: ['engine'],
  },
  'change-color': {
    platformDefaults: false,
  },
  'remove-background': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview', background: ' ' },
    lockedFields: ['engine'],
  },
  'remove-watermark': {
    platformDefaults: false,
    fixedDefaults: { engine: 'google/gemini-3-pro-image-preview' },
    lockedFields: ['engine'],
  },
  'remove-face': {
    platformDefaults: false,
  },
};

export interface MaybeAiGeneratedImageResolution {
  app: string;
  title: string;
  imageKind: MaybeAiImageKind;
  input: Record<string, unknown>;
  appliedDefaults: Record<string, unknown>;
  modelProfile?: {
    model: MaybeAiImageModel;
    priority: number | null;
    supportedRatios: MaybeAiAspectRatio[];
  };
  platformProfile?: {
    platform: MaybeAiPlatform;
    defaultRatio: MaybeAiAspectRatio;
    ratio: MaybeAiAspectRatio;
    allowedRatios: MaybeAiAspectRatio[];
    resolution: string;
    sourceConfidence: string[];
    notes: string[];
  };
  warnings: string[];
  variables: Array<{ name: string; default_value: unknown }>;
  outputSchema: MaybeAiGeneratedImageApp['output'];
}

export function inferMaybeAiImageKind(appId: string): MaybeAiImageKind {
  return APP_IMAGE_KIND[appId] ?? 'edit';
}

export function resolveMaybeAiGeneratedImageInput(appId: string, rawInput: Record<string, unknown>): MaybeAiGeneratedImageResolution {
  const app = getMaybeAiGeneratedImageApp(appId);
  const warnings: string[] = [];
  const appliedDefaults: Record<string, unknown> = {};
  const input = normalizeAliases(rawInput);
  const imageKind = resolveImageKind(app.id, input);
  const appPolicy = APP_POLICIES[app.id] ?? {};
  const platform = resolvePlatform(input);
  const platformRule = platform ? getMaybeAiPlatformRule(platform) : undefined;
  const canApplyPlatformDefaults = platformRule !== undefined && appPolicy.platformDefaults !== false;

  delete input.kind;
  delete input.imageKind;

  if (!hasField(app, 'platform') && input.platform !== undefined) {
    delete input.platform;
    warnings.push('platform is used for CLI adaptation only; this Shell app has no platform backend field.');
  }

  applyFixedDefaults(app, input, appPolicy, appliedDefaults);

  if (canApplyPlatformDefaults && platformRule) {
    applyPlatformDefaults(app, input, imageKind, platformRule, appliedDefaults, warnings);
  } else if (platformRule && appPolicy.platformDefaults === false) {
    warnings.push(`${app.id} keeps Shell app defaults; platform ratio defaults were not applied.`);
  }

  const resolvedRatio = readRatio(input.ratio);
  const engine = resolveEngine(app, input, appPolicy, resolvedRatio, appliedDefaults);
  if (engine) assertMaybeAiModelSupportsRatio(engine, resolvedRatio);

  if (hasField(app, 'angles') && input.angles === undefined) {
    const angles = platformRule?.defaultAngles ?? ['Frontal', 'Lateral', 'Posterior'];
    input.angles = angles;
    appliedDefaults.angles = angles;
  }

  const variables = toWorkflowVariables(app, input);
  const outputRatio = resolvedRatio ?? (canApplyPlatformDefaults ? platformRule?.defaultRatio : undefined);

  return {
    app: app.id,
    title: app.title,
    imageKind,
    input,
    appliedDefaults,
    modelProfile: engine ? {
      model: engine,
      priority: getMaybeAiImageModelProfile(engine).priority,
      supportedRatios: getMaybeAiImageModelProfile(engine).supportedRatios,
    } : undefined,
    platformProfile: platformRule && outputRatio
      ? {
        platform: platformRule.platform,
        defaultRatio: platformRule.defaultRatio,
        ratio: outputRatio,
        allowedRatios: platformRule.allowedRatios,
        resolution: String(input.resolution ?? platformRule.defaultResolution),
        sourceConfidence: Array.from(new Set(platformRule.sources.map((source) => source.confidence))),
        notes: platformRule.notes,
      }
      : undefined,
    warnings,
    variables,
    outputSchema: app.output,
  };
}

function normalizeAliases(rawInput: Record<string, unknown>): Record<string, unknown> {
  const input = { ...rawInput };
  if (input.engine === undefined && input.model !== undefined) {
    input.engine = input.model;
  }
  delete input.model;
  return input;
}

function resolveImageKind(appId: string, input: Record<string, unknown>): MaybeAiImageKind {
  const rawKind = input.imageKind ?? input.kind;
  if (rawKind === undefined || rawKind === null || rawKind === '') {
    return inferMaybeAiImageKind(appId);
  }
  if (typeof rawKind !== 'string' || !MAYBEAI_IMAGE_KINDS.includes(rawKind as MaybeAiImageKind)) {
    throw new ArgumentError(
      `Invalid image kind: ${String(rawKind)}`,
      `Allowed image kinds: ${MAYBEAI_IMAGE_KINDS.join(', ')}`,
    );
  }
  return rawKind as MaybeAiImageKind;
}

function resolvePlatform(input: Record<string, unknown>): MaybeAiPlatform | undefined {
  const rawPlatform = input.platform;
  if (rawPlatform === undefined || rawPlatform === null || rawPlatform === '') return undefined;
  if (typeof rawPlatform !== 'string' || !MAYBEAI_PLATFORMS.includes(rawPlatform as MaybeAiPlatform)) {
    validateMaybeAiOption('platform', rawPlatform, 'platform');
  }
  return rawPlatform as MaybeAiPlatform;
}

function applyPlatformDefaults(
  app: MaybeAiGeneratedImageApp,
  input: Record<string, unknown>,
  imageKind: MaybeAiImageKind,
  rule: MaybeAiPlatformRule,
  appliedDefaults: Record<string, unknown>,
  warnings: string[],
): void {
  if (hasField(app, 'ratio')) {
    if (input.ratio === undefined || input.ratio === null || input.ratio === '' || input.ratio === 'auto') {
      const ratio = rule.ratiosByKind[imageKind] ?? rule.defaultRatio;
      input.ratio = ratio;
      appliedDefaults.ratio = ratio;
    } else {
      const ratio = readRatio(input.ratio);
      if (ratio && !rule.allowedRatios.includes(ratio)) {
        warnings.push(`${rule.platform} ${imageKind} usually uses: ${rule.allowedRatios.join(', ')}; received ${ratio}.`);
      }
    }
  }

  if (hasField(app, 'resolution') && (input.resolution === undefined || input.resolution === null || input.resolution === '')) {
    input.resolution = rule.defaultResolution;
    appliedDefaults.resolution = rule.defaultResolution;
  }
}

function applyFixedDefaults(
  app: MaybeAiGeneratedImageApp,
  input: Record<string, unknown>,
  policy: MaybeAiAppPolicy,
  appliedDefaults: Record<string, unknown>,
): void {
  if (!policy.fixedDefaults) return;

  for (const [field, defaultValue] of Object.entries(policy.fixedDefaults)) {
    if (!hasField(app, field)) continue;
    const currentValue = input[field];
    const isMissing = currentValue === undefined || currentValue === null || currentValue === '';
    if (isMissing) {
      input[field] = defaultValue;
      appliedDefaults[field] = defaultValue;
      continue;
    }
    if (policy.lockedFields?.includes(field) && currentValue !== defaultValue) {
      throw new ArgumentError(
        `${app.id} has fixed ${field}: ${String(defaultValue)}`,
        `Remove ${field} from input or use ${field}=${String(defaultValue)}.`,
      );
    }
  }
}

function resolveEngine(
  app: MaybeAiGeneratedImageApp,
  input: Record<string, unknown>,
  policy: MaybeAiAppPolicy,
  ratio: MaybeAiAspectRatio | undefined,
  appliedDefaults: Record<string, unknown>,
): MaybeAiImageModel | undefined {
  if (!hasField(app, 'engine')) return undefined;

  const fixedEngine = policy.fixedDefaults?.engine as MaybeAiImageModel | undefined;
  const currentEngine = input.engine;

  if (fixedEngine) {
    if (currentEngine !== undefined && currentEngine !== null && currentEngine !== '' && currentEngine !== fixedEngine) {
      throw new ArgumentError(
        `${app.id} has fixed engine: ${fixedEngine}`,
        `This app follows Shell defaults and cannot switch to ${String(currentEngine)}.`,
      );
    }
    input.engine = fixedEngine;
    if (currentEngine === undefined || currentEngine === null || currentEngine === '') {
      appliedDefaults.engine = fixedEngine;
    }
    return fixedEngine;
  }

  if (currentEngine !== undefined && currentEngine !== null && currentEngine !== '') {
    validateMaybeAiOption('model', currentEngine, 'engine');
    return currentEngine as MaybeAiImageModel;
  }

  const engine = selectMaybeAiDefaultModelForRatio(ratio);
  input.engine = engine;
  appliedDefaults.engine = engine;
  return engine;
}

function hasField(app: MaybeAiGeneratedImageApp, key: string): boolean {
  return app.fields.some((field) => field.key === key);
}

function readRatio(value: unknown): MaybeAiAspectRatio | undefined {
  if (typeof value !== 'string') return undefined;
  return value as MaybeAiAspectRatio;
}
