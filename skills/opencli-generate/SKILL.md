---
name: opencli-generate
description: Use when a user asks to automatically generate a CLI command for a website. Takes a URL and optional goal, runs the full verified generation pipeline (explore, synthesize, cascade, verify), and returns a structured outcome. This is the primary entry point for "帮我生成 xxx.com 的 cli".
tags: [opencli, generate, cli, automation, verified, adapter]
---

# CLI-GENERATE — Verified CLI Generation Skill

> One-shot automated CLI generation: give a URL, get a verified command or a structured explanation of why not.

---

## When to Use This Skill

- User says "帮我生成 xxx.com 的 cli" or similar
- User wants to add a website to opencli automatically
- User provides a URL and expects a working CLI command

**Not for**: manual API exploration (use `opencli-explorer`), single-page quick generation (use `opencli-oneshot`), or browser-based debugging (use `opencli-browser`).

---

## Input

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `url` | Yes | string | Target website URL |
| `goal` | No | string | Natural language intent hint (e.g. "热榜", "搜索", "最新帖子") |

`goal` is a **user-intent hint**, not a command name, capability schema, or execution parameter.

---

## How to Invoke

```bash
opencli generate <url> [--goal <goal>] [--format json]
```

The skill calls `generateVerifiedFromUrl` internally. The agent does not need to know about explore, synthesize, cascade, or verify stages.

---

## Output: SkillOutput

```typescript
interface SkillOutput {
  // Machine-readable decision fields (agent uses these for routing)
  conclusion: 'success' | 'blocked' | 'needs-human-check';
  reason?: StopReason | EscalationReason;
  suggested_action?: SuggestedAction;
  reusability?: Reusability;

  // Structured data
  command?: string;      // e.g. "demo/hot"
  strategy?: string;     // "public" | "cookie"
  path?: string;         // TS artifact path

  // Human-readable summary (agent can relay to user directly)
  message: string;
}
```

### Decision Language (shared with code layer)

**StopReason** (blocked):
- `no-viable-api-surface` — site has no discoverable JSON APIs
- `auth-too-complex` — all endpoints require auth beyond PUBLIC/COOKIE
- `no-viable-candidate` — APIs found but no valid CLI candidate synthesized
- `execution-environment-unavailable` — browser not connected

**EscalationReason** (needs-human-check):
- `empty-result` — pipeline ran but returned nothing
- `sparse-fields` — result has too few populated fields
- `non-array-result` — result is not an array
- `unsupported-required-args` — candidate needs args we can't auto-fill
- `timeout` — execution timed out
- `selector-mismatch` — DOM/JSON path didn't match
- `verify-inconclusive` — catch-all for ambiguous verify failures

**SuggestedAction** (what to do next):
- `stop` — nothing more to try
- `inspect-with-browser` — use opencli-browser skill to debug
- `ask-for-login` — user needs to log in first
- `ask-for-sample-arg` — user needs to provide a real argument value
- `manual-review` — general human review needed

**Reusability** (is the artifact worth keeping?):
- `verified-artifact` — fully verified, can be used directly
- `unverified-candidate` — candidate exists but not verified
- `not-reusable` — nothing worth keeping

---

## Decision Tree

```
Input: url + goal?
  |
  v
Call generateVerifiedFromUrl(url, goal)
  |
  v
Receive GenerateOutcome
  |
  +-- status = 'success'
  |     conclusion: 'success'
  |     reusability: 'verified-artifact'
  |     command: outcome.adapter.command
  |     strategy: outcome.adapter.strategy
  |     path: outcome.adapter.path
  |     message: "已生成 {command}，可直接使用 (策略: {strategy})"
  |     → END
  |
  +-- status = 'blocked'
  |     conclusion: 'blocked'
  |     reason: outcome.reason
  |     message: (see message templates below)
  |     → END
  |
  +-- status = 'needs-human-check'
        conclusion: 'needs-human-check'
        reason: outcome.escalation.reason
        suggested_action: outcome.escalation.suggested_action
        reusability: outcome.reusability
        path: outcome.escalation?.candidate?.path  (optional, only when reusable candidate exists)
        message: (see message templates below)
        → END (upper-level agent decides next step)
```

### Message Templates

| conclusion | reason | message |
|------------|--------|---------|
| `success` | — | "已生成 {command}，可直接使用。策略: {strategy}" |
| `blocked` | `no-viable-api-surface` | "该站点没有发现可用的 JSON API 接口，无法自动生成 CLI" |
| `blocked` | `auth-too-complex` | "所有接口都需要超出自动化能力的认证方式（如 signature/bearer），无法自动生成" |
| `blocked` | `no-viable-candidate` | "发现了 API 接口，但未能合成有效的 CLI 候选" |
| `blocked` | `execution-environment-unavailable` | "浏览器未连接，请先运行 opencli doctor 检查环境" |
| `needs-human-check` | `unsupported-required-args` | "候选需要参数 {args}，请提供示例值后重试" |
| `needs-human-check` | `empty-result` | "候选验证返回空结果，建议用 opencli-browser 检查" |
| `needs-human-check` | `sparse-fields` | "候选验证结果字段不足，建议人工检查" |
| `needs-human-check` | `non-array-result` | "返回结果不是数组格式，建议用 opencli-browser 检查接口返回结构" |
| `needs-human-check` | `timeout` | "验证超时，建议用 opencli-browser 手动检查接口响应" |
| `needs-human-check` | `selector-mismatch` | "数据路径不匹配，建议用 opencli-browser 检查实际返回结构" |
| `needs-human-check` | `verify-inconclusive` | "验证结果不确定，候选已保存在 {path}，需要人工审查" |

---

## Guardrails

1. **Skill does not orchestrate internal pipeline stages.** It does not decide whether to explore, synthesize, cascade, or verify. That is the code layer's job.

2. **Skill does not auto-escalate to browser.** When `needs-human-check`, skill reports the recommendation but does not automatically invoke `opencli-browser`. The upper-level agent decides.

3. **No new taxonomy.** All `reason`, `suggested_action`, `reusability` values are shared with the code layer (`GenerateOutcome`). Skill does not invent new status words.

4. **Machine-readable fields are the contract; `message` is just a summary.** Callers must not parse `message` for decision-making.

5. **`goal` is a natural language intent hint.** Not a command name, not a capability schema, not an execution parameter.

---

## Relationship to Other Primitives

### P1: Terminal Contract (`GenerateOutcome`)
- Skill's **single source of truth** for final decisions
- Skill maps `GenerateOutcome` → `SkillOutput` (thin translation, no re-orchestration)

### P2: Early-Hint Contract (`EarlyHint`)
- Lives **inside the orchestrator**, transparent to skill
- Drives early exit (cost optimization) before verify stage
- Skill does not consume `EarlyHint` directly in v1
- May be exposed as optional progress channel in future versions

### v1 Scope
- JSON API + PUBLIC/COOKIE auth + structured array result + read-only list-like capabilities
- Single browser session lifecycle (probe + verify share one session)
- Bounded repair: only itemPath relocation, one attempt
