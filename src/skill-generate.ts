/**
 * Generate skill: thin wrapper over generateVerifiedFromUrl.
 *
 * Maps GenerateOutcome → SkillOutput.
 * Used by `opencli generate <url>` (automated path in opencli-explorer workflow).
 *
 * Design:
 *   - Input: url + goal? (user intent, not execution strategy)
 *   - Output: machine-readable decision fields + human-readable message
 *   - Single source of truth: P1 GenerateOutcome
 *   - No re-orchestration, no auto-escalation to browser
 */

import {
  generateVerifiedFromUrl,
  type GenerateOutcome,
  type StopReason,
  type EscalationReason,
  type SuggestedAction,
  type Reusability,
  type GenerateVerifiedOptions,
} from './generate-verified.js';
import type { IBrowserFactory } from './runtime.js';

// ── Skill I/O ────────────────────────────────────────────────────────────────

export interface SkillInput {
  url: string;
  goal?: string;
}

export interface SkillOutput {
  conclusion: 'success' | 'blocked' | 'needs-human-check';
  reason?: StopReason | EscalationReason;
  suggested_action?: SuggestedAction;
  reusability?: Reusability;
  command?: string;
  strategy?: string;
  path?: string;
  message: string;
}

// ── Message Templates ────────────────────────────────────────────────────────

const BLOCKED_MESSAGES: Record<StopReason, string> = {
  'no-viable-api-surface': '该站点没有发现可用的 JSON API 接口，无法自动生成 CLI',
  'auth-too-complex': '所有接口都需要超出自动化能力的认证方式（如 signature/bearer），无法自动生成',
  'no-viable-candidate': '发现了 API 接口，但未能合成有效的 CLI 候选',
  'execution-environment-unavailable': '浏览器未连接，请先运行 opencli doctor 检查环境',
};

const ESCALATION_MESSAGES: Record<EscalationReason, (ctx?: { args?: string; path?: string }) => string> = {
  'unsupported-required-args': () => '候选需要用户提供必填参数的示例值后重试',
  'empty-result': () => '候选验证返回空结果，建议用 opencli-browser 检查',
  'sparse-fields': () => '候选验证结果字段不足，建议人工检查',
  'non-array-result': () => '返回结果不是数组格式，建议用 opencli-browser 检查接口返回结构',
  'timeout': () => '验证超时，建议用 opencli-browser 手动检查接口响应',
  'selector-mismatch': () => '数据路径不匹配，建议用 opencli-browser 检查实际返回结构',
  'verify-inconclusive': (ctx) => ctx?.path
    ? `验证结果不确定，候选已保存在 ${ctx.path}，需要人工审查`
    : '验证结果不确定，需要人工审查',
};

// ── Core Mapping ─────────────────────────────────────────────────────────────

export function mapOutcomeToSkillOutput(outcome: GenerateOutcome): SkillOutput {
  switch (outcome.status) {
    case 'success':
      return {
        conclusion: 'success',
        reusability: outcome.reusability ?? 'verified-artifact',
        command: outcome.adapter?.command,
        strategy: outcome.adapter?.strategy,
        path: outcome.adapter?.path,
        message: `已生成 ${outcome.adapter?.command ?? 'unknown'}，可直接使用。策略: ${outcome.adapter?.strategy ?? 'unknown'}`,
      };

    case 'blocked':
      return {
        conclusion: 'blocked',
        reason: outcome.reason,
        message: BLOCKED_MESSAGES[outcome.reason!] ?? outcome.message ?? '生成被阻断',
      };

    case 'needs-human-check': {
      const escalation = outcome.escalation;
      const reason = escalation?.reason;
      const candidatePath = escalation?.candidate?.path ?? undefined;
      const messageFn = reason ? ESCALATION_MESSAGES[reason] : undefined;
      return {
        conclusion: 'needs-human-check',
        reason,
        suggested_action: escalation?.suggested_action,
        reusability: outcome.reusability,
        path: candidatePath ?? undefined,
        message: outcome.message ?? messageFn?.({ path: candidatePath ?? undefined }) ?? '需要人工检查',
      };
    }
  }
}

// ── Skill Entry Point ────────────────────────────────────────────────────────

export async function executeGenerateSkill(
  input: SkillInput,
  BrowserFactory: new () => IBrowserFactory,
): Promise<SkillOutput> {
  const opts: GenerateVerifiedOptions = {
    url: input.url,
    BrowserFactory,
    goal: input.goal ?? null,
  };
  const outcome = await generateVerifiedFromUrl(opts);
  return mapOutcomeToSkillOutput(outcome);
}
