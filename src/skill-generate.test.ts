import { describe, expect, it } from 'vitest';
import { mapOutcomeToSkillOutput, type SkillOutput } from './skill-generate.js';
import type { GenerateOutcome } from './generate-verified.js';
import { Strategy } from './registry.js';

describe('mapOutcomeToSkillOutput', () => {
  const baseStats = {
    endpoint_count: 1,
    api_endpoint_count: 1,
    candidate_count: 1,
    verified: false,
    repair_attempted: false,
    explore_dir: '/tmp/test',
  };

  it('maps success outcome correctly', () => {
    const outcome: GenerateOutcome = {
      status: 'success',
      adapter: {
        site: 'demo',
        name: 'hot',
        command: 'demo/hot',
        strategy: Strategy.PUBLIC,
        path: '/tmp/demo/hot.verified.ts',
        metadata_path: '/tmp/demo/hot.meta.json',
        reusability: 'verified-artifact',
      },
      reusability: 'verified-artifact',
      stats: { ...baseStats, verified: true },
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('success');
    expect(result.reusability).toBe('verified-artifact');
    expect(result.command).toBe('demo/hot');
    expect(result.strategy).toBe('public');
    expect(result.path).toBe('/tmp/demo/hot.verified.ts');
    expect(result.message).toContain('demo/hot');
    expect(result.reason).toBeUndefined();
    expect(result.suggested_action).toBeUndefined();
  });

  it('maps blocked outcome with no-viable-api-surface', () => {
    const outcome: GenerateOutcome = {
      status: 'blocked',
      reason: 'no-viable-api-surface',
      stage: 'explore',
      confidence: 'high',
      message: 'No API endpoints',
      stats: { ...baseStats, api_endpoint_count: 0 },
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('blocked');
    expect(result.reason).toBe('no-viable-api-surface');
    expect(result.message).toContain('JSON API');
    expect(result.command).toBeUndefined();
    expect(result.suggested_action).toBeUndefined();
  });

  it('maps blocked outcome with auth-too-complex', () => {
    const outcome: GenerateOutcome = {
      status: 'blocked',
      reason: 'auth-too-complex',
      stage: 'cascade',
      confidence: 'high',
      stats: baseStats,
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('blocked');
    expect(result.reason).toBe('auth-too-complex');
    expect(result.message).toContain('认证');
  });

  it('maps blocked outcome with execution-environment-unavailable', () => {
    const outcome: GenerateOutcome = {
      status: 'blocked',
      reason: 'execution-environment-unavailable',
      stage: 'verify',
      confidence: 'high',
      stats: baseStats,
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('blocked');
    expect(result.reason).toBe('execution-environment-unavailable');
    expect(result.message).toContain('doctor');
  });

  it('maps needs-human-check with unsupported-required-args', () => {
    const outcome: GenerateOutcome = {
      status: 'needs-human-check',
      escalation: {
        stage: 'synthesize',
        reason: 'unsupported-required-args',
        confidence: 'high',
        suggested_action: 'ask-for-sample-arg',
        candidate: {
          name: 'detail',
          command: 'demo/detail',
          path: '/tmp/demo/detail.verified.ts',
          reusability: 'unverified-candidate',
        },
      },
      reusability: 'unverified-candidate',
      message: 'required args: id',
      stats: baseStats,
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('needs-human-check');
    expect(result.reason).toBe('unsupported-required-args');
    expect(result.suggested_action).toBe('ask-for-sample-arg');
    expect(result.reusability).toBe('unverified-candidate');
    expect(result.path).toBe('/tmp/demo/detail.verified.ts');
    expect(result.message).toContain('required args: id');
  });

  it('maps needs-human-check with empty-result (inspect-with-browser)', () => {
    const outcome: GenerateOutcome = {
      status: 'needs-human-check',
      escalation: {
        stage: 'fallback',
        reason: 'empty-result',
        confidence: 'low',
        suggested_action: 'inspect-with-browser',
        candidate: {
          name: 'hot',
          command: 'demo/hot',
          path: null,
          reusability: 'unverified-candidate',
        },
      },
      reusability: 'unverified-candidate',
      stats: { ...baseStats, repair_attempted: true },
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('needs-human-check');
    expect(result.reason).toBe('empty-result');
    expect(result.suggested_action).toBe('inspect-with-browser');
    expect(result.path).toBeUndefined();
    expect(result.message).toContain('空结果');
  });

  it('maps needs-human-check with verify-inconclusive and path', () => {
    const outcome: GenerateOutcome = {
      status: 'needs-human-check',
      escalation: {
        stage: 'verify',
        reason: 'verify-inconclusive',
        confidence: 'low',
        suggested_action: 'manual-review',
        candidate: {
          name: 'hot',
          command: 'demo/hot',
          path: '/tmp/demo/hot.verified.ts',
          reusability: 'unverified-candidate',
        },
      },
      reusability: 'unverified-candidate',
      stats: baseStats,
    };

    const result = mapOutcomeToSkillOutput(outcome);

    expect(result.conclusion).toBe('needs-human-check');
    expect(result.reason).toBe('verify-inconclusive');
    expect(result.suggested_action).toBe('manual-review');
    expect(result.path).toBe('/tmp/demo/hot.verified.ts');
    expect(result.message).toContain('/tmp/demo/hot.verified.ts');
  });

  it('output satisfies SkillOutput contract shape', () => {
    const outcome: GenerateOutcome = {
      status: 'blocked',
      reason: 'no-viable-candidate',
      stage: 'synthesize',
      confidence: 'medium',
      stats: baseStats,
    };

    const result: SkillOutput = mapOutcomeToSkillOutput(outcome);

    // Every SkillOutput must have conclusion + message
    expect(result).toHaveProperty('conclusion');
    expect(result).toHaveProperty('message');
    expect(['success', 'blocked', 'needs-human-check']).toContain(result.conclusion);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });
});
