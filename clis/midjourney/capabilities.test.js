import { expect, it } from 'vitest';
import {
  assertActionPlan,
  assertBudget,
  buildEffectivePrompt,
  estimateAction,
  resolveGenerationPlan,
} from './capabilities.js';
import { creditsToFastMinutes } from './utils.js';

const basic = {
  plan: { type: 'basic' },
  status: 'active',
  total_credits: 12_000_000,
  abilities: { can_relax: false, can_turbo: true, can_private: false, fast_jobs: 3 },
};
const standard = {
  ...basic,
  plan: { type: 'standard' },
  abilities: { ...basic.abilities, can_relax: true, can_private: true },
};

function plan(prompt = 'blue circle', args = {}, extra = {}) {
  return resolveGenerationPlan({
    prompt,
    args: { model: 'auto', resolution: 'auto', speed: 'auto', ...args },
    hasOmniReference: false,
    account: basic,
    siteModel: 'v8.2',
    siteResolution: 'sd',
    siteSpeed: 'fast',
    ...extra,
  });
}

it('generation cost and automatic model routing matrix', () => {
  expect(plan()).toEqual({
    requestedModel: 'auto', effectiveModel: 'v8.2', routingReason: null,
    resolution: 'sd', speed: 'fast', repeat: 1, estimatedMinutes: 1,
  });
  expect(plan('blue circle', {}, { hasOmniReference: true })).toEqual({
    requestedModel: 'auto', effectiveModel: 'v7', routingReason: 'omni_reference_requires_v7',
    resolution: 'sd', speed: 'fast', repeat: 1, estimatedMinutes: 2,
  });
  expect(plan('blue circle', { resolution: 'hd' }).estimatedMinutes).toBe(1.5);
  expect(plan('blue circle --v 6 --q .5').estimatedMinutes).toBe(1);
  expect(plan('blue circle --v 6 --turbo').estimatedMinutes).toBe(2);
  expect(plan('blue circle', { repeat: 4 }).estimatedMinutes).toBe(4);
  expect(plan('blue circle --repeat 2').repeat).toBe(2);
  expect(plan('blue circle --relax', {}, { account: standard, siteSpeed: 'fast' }).estimatedMinutes).toBe(0);
});

it('generation compatibility failures are explicit', () => {
  expect(() => plan('blue', { model: 'v8.2' }, { hasOmniReference: true })).toThrow(/requires V7/);
  expect(() => plan('blue --v 8.2 --oref https:\/\/example.com\/a.png')).toThrow(/conflicts/);
  expect(() => plan('blue --v 7 --hd')).toThrow(/HD image generation/);
  expect(() => plan('blue --sd --hd')).toThrow(/cannot combine --sd and --hd/);
  expect(() => plan('blue --relax')).toThrow(/does not support Relax/);
  expect(() => plan('blue --fast --relax')).toThrow(/cannot combine more than one/);
  expect(() => plan('blue --v 8.2 --turbo')).toThrow(/does not support Turbo/);
  expect(() => plan('blue --v 8.2 --cref https:\/\/example.com\/a.png')).toThrow(/Character Reference/);
  expect(() => plan('red::2 blue::1 --v 8.2')).toThrow(/Multi-prompt/);
  expect(() => plan('blue --v 8.2 --q 1')).toThrow(/quality/);
  expect(() => plan('blue --v 99')).toThrow(/Unsupported Midjourney version/);
  expect(() => plan('blue --video 1')).toThrow(/Video parameters/);
  expect(() => plan('blue', { repeat: 5 })).toThrow(/at most 4/);
  expect(() => plan('blue --repeat 2', { repeat: 3 })).toThrow(/conflicts/);
});

it('plan capability, action cost, and budget guards', () => {
  expect(estimateAction('upscale-creative')).toBe(2);
  expect(estimateAction('animate-low', { videoResolution: 'sd', batchSize: 4 })).toBe(8);
  expect(estimateAction('extend-high', { videoResolution: 'hd', batchSize: 4 })).toBe(26);
  expect(estimateAction('rerun', { sourceIsVideo: true, videoResolution: 'sd', batchSize: 2 })).toBe(4);
  expect(estimateAction('vary-subtle', { sourceUsesOmni: true })).toBe(2);
  expect(estimateAction('rerun', { sourceUsesOmni: true })).toBe(2);
  expect(() => assertActionPlan(basic, 'animate-low', { videoResolution: 'hd' })).toThrow(/does not support HD video/);
  expect(() => assertActionPlan(standard, 'animate-low', { videoResolution: 'hd' })).not.toThrow();
  expect(() => assertBudget(basic, 3, 2, 0, creditsToFastMinutes)).toThrow(/exceeds/);
  expect(() => assertBudget({ ...basic, total_credits: 120_000 }, 1, 2, 2, creditsToFastMinutes)).toThrow(/reserve/);
});

it('effective prompt keeps native parameters and adds structured references', () => {
  const resolved = plan('blue circle');
  expect(buildEffectivePrompt('blue circle --ar 1:1', resolved, {
    model: 'v7', resolution: 'sd', speed: 'fast', repeat: 2,
    profile: 'abc', 'image-weight': 1.2, 'style-weight': 300, 'omni-weight': null,
  }, {
    image: ['https://example.com/image.png'], style: ['12345'], omni: [],
  })).toBe('https://example.com/image.png blue circle --ar 1:1 --v 7 --sd --fast --repeat 2 --profile abc --sref 12345 --iw 1.2 --sw 300');
});
