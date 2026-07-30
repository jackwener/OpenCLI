import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const MODEL_CHOICES = ['auto', 'v8.2', 'v8.1', 'v7', 'v6.1', 'v6', 'niji7', 'niji6'];
export const RESOLUTION_CHOICES = ['auto', 'sd', 'hd'];
export const SPEED_CHOICES = ['auto', 'fast', 'relax', 'turbo'];

export const GPU_COST_MINUTES = Object.freeze({
  imageSd: 1,
  imageHd: 1.5,
  variationMax: 1,
  upscale: 2,
  omni: 2,
  videoSd1: 2,
  videoSd2: 4,
  videoSd4: 8,
  videoHd1: 7,
  videoHd2: 13,
  videoHd4: 26,
});

const ACTION_COSTS = Object.freeze({
  rerun: GPU_COST_MINUTES.imageSd,
  'rerun-hd': GPU_COST_MINUTES.imageHd,
  'vary-subtle': GPU_COST_MINUTES.variationMax,
  'vary-strong': GPU_COST_MINUTES.variationMax,
  'upscale-subtle': GPU_COST_MINUTES.upscale,
  'upscale-creative': GPU_COST_MINUTES.upscale,
});

export const ACTION_CHOICES = [
  'rerun',
  'rerun-hd',
  'vary-subtle',
  'vary-strong',
  'upscale-subtle',
  'upscale-creative',
  'open-editor',
  'animate-low',
  'animate-high',
  'loop-low',
  'loop-high',
  'extend-low',
  'extend-high',
  'cancel',
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function promptParamValue(prompt, names) {
  const joined = names.map(escapeRegex).join('|');
  const regex = new RegExp(`(?:^|\\s)--(?:${joined})\\s+([^\\s]+)`, 'gi');
  let match = null;
  let value = null;
  while ((match = regex.exec(String(prompt || ''))) !== null) value = match[1];
  return value;
}

export function promptHasFlag(prompt, names) {
  const joined = names.map(escapeRegex).join('|');
  return new RegExp(`(?:^|\\s)--(?:${joined})(?=\\s|$)`, 'i').test(String(prompt || ''));
}

export function promptHasMultiPrompt(prompt) {
  return /(^|\s)[^\s:][^\n]*::(?:-?\d+(?:\.\d+)?)?(?=\s|$)/.test(String(prompt || ''));
}

export function normalizeChoice(value, fallback, choices, label) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!choices.includes(normalized)) {
    throw new ArgumentError(`${label} must be one of: ${choices.join(', ')}`);
  }
  return normalized;
}

export function normalizeNonNegativeNumber(value, fallback, label) {
  const raw = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(raw) || raw < 0) throw new ArgumentError(`${label} must be a non-negative number`);
  return raw;
}

export function normalizeWeight(value, min, max, label) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ArgumentError(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

function normalizeModelToken(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/^v/, '');
  if (normalized === '8.2') return 'v8.2';
  if (normalized === '8.1') return 'v8.1';
  if (normalized === '7') return 'v7';
  if (normalized === '6.1') return 'v6.1';
  if (normalized === '6') return 'v6';
  return null;
}

function structuredVsRaw(structured, raw, label) {
  if (structured !== 'auto' && raw && structured !== raw) {
    throw new ArgumentError(`${label} conflicts with the same parameter in the prompt (${structured} vs ${raw})`);
  }
  return structured === 'auto' ? raw : structured;
}

function planType(account) {
  return String(account?.plan?.type || '').trim().toLowerCase();
}

function planRepeatLimit(plan) {
  if (plan === 'basic') return 4;
  if (plan === 'standard') return 10;
  if (plan === 'pro' || plan === 'mega') return 40;
  return 1;
}

export function planCapabilities(account) {
  const plan = planType(account);
  return {
    plan,
    canRelax: Boolean(account?.abilities?.can_relax),
    canTurbo: Boolean(account?.abilities?.can_turbo),
    canPrivate: Boolean(account?.abilities?.can_private),
    canHdVideo: ['standard', 'pro', 'mega'].includes(plan),
    repeatLimit: planRepeatLimit(plan),
    fastConcurrency: Number.isFinite(Number(account?.abilities?.fast_jobs)) ? Number(account.abilities.fast_jobs) : null,
    fastVideoConcurrency: Number.isFinite(Number(account?.abilities?.fast_video_job_concurrency))
      ? Number(account.abilities.fast_video_job_concurrency)
      : null,
  };
}

export function resolveGenerationPlan({
  prompt,
  args,
  hasOmniReference,
  account,
  siteModel = 'v8.2',
  siteResolution = 'sd',
  siteSpeed = 'fast',
}) {
  const requestedModel = normalizeChoice(args.model, 'auto', MODEL_CHOICES, '--model');
  const structuredResolution = normalizeChoice(args.resolution, 'auto', RESOLUTION_CHOICES, '--resolution');
  const structuredSpeed = normalizeChoice(args.speed, 'auto', SPEED_CHOICES, '--speed');

  const nijiRaw = promptParamValue(prompt, ['niji']);
  const versionToken = promptParamValue(prompt, ['v', 'version']);
  const versionRaw = normalizeModelToken(versionToken);
  if (versionToken && !versionRaw) {
    throw new ArgumentError(`Unsupported Midjourney version "${versionToken}"`);
  }
  if (nijiRaw && versionRaw) throw new ArgumentError('Prompt cannot combine --niji and --v/--version');
  const rawModel = nijiRaw ? `niji${String(nijiRaw).replace(/^v/i, '')}` : versionRaw;
  let selectedModel = structuredVsRaw(requestedModel, rawModel, '--model');
  if (!selectedModel) selectedModel = normalizeModelToken(siteModel) || 'v8.2';

  let routingReason = null;
  if (hasOmniReference || promptHasFlag(prompt, ['oref'])) {
    if (requestedModel !== 'auto' && selectedModel !== 'v7') {
      throw new ArgumentError('Omni Reference requires V7; use --model auto or --model v7');
    }
    if (requestedModel === 'auto' && rawModel && rawModel !== 'v7') {
      throw new ArgumentError('Omni Reference in the prompt conflicts with the selected model; use V7');
    }
    selectedModel = 'v7';
    routingReason = 'omni_reference_requires_v7';
  }

  if (!MODEL_CHOICES.includes(selectedModel)) {
    throw new ArgumentError(`Unsupported Midjourney model "${selectedModel}"`);
  }

  const rawResolutionFlags = ['sd', 'hd'].filter((value) => promptHasFlag(prompt, [value]));
  if (rawResolutionFlags.length > 1) {
    throw new ArgumentError('Prompt cannot combine --sd and --hd');
  }
  const [rawResolution = null] = rawResolutionFlags;
  const resolution = structuredVsRaw(structuredResolution, rawResolution, '--resolution')
    || normalizeChoice(siteResolution, 'sd', ['sd', 'hd'], 'site image resolution');
  if (resolution === 'hd' && !['v8.1', 'v8.2'].includes(selectedModel)) {
    throw new ArgumentError(`HD image generation is only supported by V8.1/V8.2, not ${selectedModel}`);
  }

  const rawSpeedFlags = ['fast', 'relax', 'turbo'].filter((value) => promptHasFlag(prompt, [value]));
  if (rawSpeedFlags.length > 1) {
    throw new ArgumentError('Prompt cannot combine more than one of --fast, --relax, or --turbo');
  }
  const [rawSpeed = null] = rawSpeedFlags;
  const speed = structuredVsRaw(structuredSpeed, rawSpeed, '--speed')
    || normalizeChoice(siteSpeed, 'fast', ['fast', 'relax', 'turbo'], 'site speed');
  const capabilities = planCapabilities(account);
  if (speed === 'relax' && !capabilities.canRelax) {
    throw new ArgumentError(`${capabilities.plan || 'current'} plan does not support Relax mode`);
  }
  if (speed === 'turbo' && ['v8.1', 'v8.2'].includes(selectedModel)) {
    throw new ArgumentError(`${selectedModel} does not support Turbo mode; use fast or relax`);
  }
  if (speed === 'turbo' && !capabilities.canTurbo) {
    throw new ArgumentError(`${capabilities.plan || 'current'} plan does not support Turbo mode`);
  }
  if (promptHasFlag(prompt, ['stealth']) && !capabilities.canPrivate) {
    throw new ArgumentError(`${capabilities.plan || 'current'} plan does not support Stealth mode`);
  }

  if (promptHasFlag(prompt, ['draft']) && selectedModel !== 'v7') {
    throw new ArgumentError('Draft mode requires V7');
  }
  if (promptHasMultiPrompt(prompt) && !['v6', 'v6.1', 'niji6'].includes(selectedModel)) {
    throw new ArgumentError(`Multi-prompt weights are not supported by ${selectedModel}; use V6/V6.1`);
  }
  if (promptParamValue(prompt, ['cref']) && !['v6', 'v6.1', 'niji6'].includes(selectedModel)) {
    throw new ArgumentError(`Character Reference (--cref) is not supported by ${selectedModel}; use V6/V6.1/Niji 6 or Omni Reference on V7`);
  }
  if (promptHasFlag(prompt, ['video', 'loop'])
    || promptParamValue(prompt, ['video', 'bs', 'motion', 'end'])) {
    throw new ArgumentError('Video parameters are not accepted by generate; create an image first, then use `midjourney action`');
  }
  const quality = promptParamValue(prompt, ['q', 'quality']);
  if (quality && ['v8.1', 'v8.2'].includes(selectedModel)) {
    throw new ArgumentError(`--quality is not supported by ${selectedModel}`);
  }
  if (quality) {
    const normalizedQuality = Number(quality);
    if (![0.25, 0.5, 1].includes(normalizedQuality)) {
      throw new ArgumentError('--quality must be 0.25, 0.5, or 1 for supported legacy models');
    }
  }

  const rawRepeat = promptParamValue(prompt, ['r', 'repeat']);
  const structuredRepeat = args.repeat == null || args.repeat === '' ? null : Number(args.repeat);
  if (structuredRepeat != null && (!Number.isInteger(structuredRepeat) || structuredRepeat < 1)) {
    throw new ArgumentError('--repeat must be a positive integer');
  }
  if (rawRepeat != null && (!/^\d+$/.test(rawRepeat) || Number(rawRepeat) < 1)) {
    throw new ArgumentError('--repeat in the prompt must be a positive integer');
  }
  if (structuredRepeat != null && rawRepeat != null && structuredRepeat !== Number(rawRepeat)) {
    throw new ArgumentError(`--repeat conflicts with the prompt (${structuredRepeat} vs ${rawRepeat})`);
  }
  const repeat = structuredRepeat ?? (rawRepeat == null ? 1 : Number(rawRepeat));
  if (repeat > capabilities.repeatLimit) {
    throw new ArgumentError(`${capabilities.plan || 'current'} plan allows at most ${capabilities.repeatLimit} repeat/permutation jobs`);
  }

  let perJobMinutes = hasOmniReference || promptHasFlag(prompt, ['oref'])
    ? GPU_COST_MINUTES.omni
    : resolution === 'hd'
      ? GPU_COST_MINUTES.imageHd
      : GPU_COST_MINUTES.imageSd;
  if (promptHasFlag(prompt, ['draft'])) perJobMinutes /= 2;
  // The current web service charged a full SD batch for a live V6 --q 0.5
  // job. Keep the cost guard conservative instead of applying historical
  // quality discounts that are no longer reflected in account credits.
  if (speed === 'turbo') perJobMinutes *= 2;
  // Relax jobs do not consume the subscription's Fast GPU minute balance.
  // Keep the guard and reported estimate aligned with the quota it protects.
  if (speed === 'relax') perJobMinutes = 0;
  const estimatedMinutes = Number((perJobMinutes * repeat).toFixed(2));

  return {
    requestedModel,
    effectiveModel: selectedModel,
    routingReason,
    resolution,
    speed,
    repeat,
    estimatedMinutes,
  };
}

export function assertBudget(account, estimatedMinutes, maxMinutes, reserveMinutes, creditsToMinutes) {
  const max = normalizeNonNegativeNumber(maxMinutes, 2, '--max-minutes');
  const reserve = normalizeNonNegativeNumber(reserveMinutes, 0, '--reserve-minutes');
  if (estimatedMinutes > max) {
    throw new ArgumentError(`Estimated GPU cost ${estimatedMinutes} minutes exceeds --max-minutes ${max}`);
  }
  const remainingCredits = Number(account?.total_credits ?? account?.credits_total);
  const remainingMinutes = creditsToMinutes(remainingCredits);
  if (Number.isFinite(remainingMinutes) && remainingMinutes - estimatedMinutes < reserve) {
    throw new CommandExecutionError(
      `Midjourney budget guard would leave ${Number((remainingMinutes - estimatedMinutes).toFixed(2))} minutes, below the ${reserve}-minute reserve`,
    );
  }
  return { maxMinutes: max, reserveMinutes: reserve, remainingMinutes };
}

export function estimateAction(
  operation,
  { videoResolution = 'sd', batchSize = 1, sourceIsVideo = false, sourceUsesOmni = false } = {},
) {
  if (!ACTION_CHOICES.includes(operation)) {
    throw new ArgumentError(`operation must be one of: ${ACTION_CHOICES.join(', ')}`);
  }
  if (operation === 'open-editor' || operation === 'cancel') return 0;
  if (operation === 'rerun' && sourceIsVideo) {
    if (!['sd', 'hd'].includes(videoResolution)) throw new ArgumentError('--video-resolution must be sd or hd');
    if (![1, 2, 4].includes(batchSize)) throw new ArgumentError('--batch-size must be 1, 2, or 4');
    return GPU_COST_MINUTES[`video${videoResolution === 'hd' ? 'Hd' : 'Sd'}${batchSize}`];
  }
  if (sourceUsesOmni && ['rerun', 'vary-subtle', 'vary-strong'].includes(operation)) {
    return GPU_COST_MINUTES.omni;
  }
  if (Object.prototype.hasOwnProperty.call(ACTION_COSTS, operation)) return ACTION_COSTS[operation];
  if (['animate-low', 'animate-high', 'loop-low', 'loop-high', 'extend-low', 'extend-high'].includes(operation)) {
    if (!['sd', 'hd'].includes(videoResolution)) throw new ArgumentError('--video-resolution must be sd or hd');
    if (![1, 2, 4].includes(batchSize)) throw new ArgumentError('--batch-size must be 1, 2, or 4');
    return GPU_COST_MINUTES[`video${videoResolution === 'hd' ? 'Hd' : 'Sd'}${batchSize}`];
  }
  throw new ArgumentError(`No cost model is defined for action "${operation}"`);
}

export function assertActionPlan(account, operation, { videoResolution = 'sd' } = {}) {
  const capabilities = planCapabilities(account);
  if (videoResolution === 'hd' && !capabilities.canHdVideo
    && ['animate-low', 'animate-high', 'loop-low', 'loop-high', 'extend-low', 'extend-high'].includes(operation)) {
    throw new ArgumentError(`${capabilities.plan || 'current'} plan does not support HD video; use --video-resolution sd`);
  }
  return capabilities;
}

export function buildEffectivePrompt(prompt, plan, args, remoteReferences = {}) {
  let result = String(prompt || '').trim();
  const imageUrls = remoteReferences.image || [];
  if (imageUrls.length) result = `${imageUrls.join(' ')} ${result}`.trim();

  const additions = [];
  if (!promptParamValue(result, ['v', 'version']) && !promptParamValue(result, ['niji']) && args.model && args.model !== 'auto') {
    if (String(args.model).startsWith('niji')) additions.push(`--niji ${String(args.model).slice(4)}`);
    else additions.push(`--v ${String(args.model).replace(/^v/, '')}`);
  } else if (plan.routingReason === 'omni_reference_requires_v7' && !promptParamValue(result, ['v', 'version'])) {
    additions.push('--v 7');
  }
  if (!promptHasFlag(result, ['sd', 'hd']) && args.resolution && args.resolution !== 'auto') additions.push(`--${args.resolution}`);
  if (!promptHasFlag(result, ['fast', 'relax', 'turbo']) && args.speed && args.speed !== 'auto') additions.push(`--${args.speed}`);
  if (!promptParamValue(result, ['r', 'repeat']) && Number(args.repeat) > 1) additions.push(`--repeat ${Number(args.repeat)}`);
  if (!promptParamValue(result, ['p', 'profile']) && args.profile) additions.push(`--profile ${String(args.profile).trim()}`);
  if (remoteReferences.style?.length && !promptHasFlag(result, ['sref'])) additions.push(`--sref ${remoteReferences.style.join(' ')}`);
  if (remoteReferences.omni?.length && !promptHasFlag(result, ['oref'])) additions.push(`--oref ${remoteReferences.omni[0]}`);
  if (args['image-weight'] != null && args['image-weight'] !== '' && !promptParamValue(result, ['iw'])) additions.push(`--iw ${args['image-weight']}`);
  if (args['style-weight'] != null && args['style-weight'] !== '' && !promptParamValue(result, ['sw'])) additions.push(`--sw ${args['style-weight']}`);
  if (args['omni-weight'] != null && args['omni-weight'] !== '' && !promptParamValue(result, ['ow'])) additions.push(`--ow ${args['omni-weight']}`);
  return [result, ...additions].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
