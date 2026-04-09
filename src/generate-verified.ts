/**
 * Verified adapter generation:
 * discover → synthesize → candidate-bound probe → single-session verify.
 *
 * v1 contract keeps scope narrow:
 *   - PUBLIC + COOKIE only
 *   - read-only JSON API surfaces
 *   - single best candidate only
 *   - bounded repair: select/itemPath replacement once
 *
 * Contract design principles:
 *   1. machine-readable
 *   2. explicit + explainable
 *   3. testable + versioned
 *   4. taxonomy by skill decision needs (not internal error sources)
 *   5. early hint / terminal outcome share consistent decision language
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exploreUrl } from './explore.js';
import { loadExploreBundle, synthesizeFromExplore, type CandidateYaml, type SynthesizeCandidateSummary } from './synthesize.js';
import { normalizeGoal, selectCandidate } from './generate.js';
import { browserSession, type IBrowserFactory } from './runtime.js';
import { executePipeline } from './pipeline/index.js';
import { registerCommand, Strategy, type CliCommand } from './registry.js';
import {
  AuthRequiredError,
  BrowserConnectError,
  CommandExecutionError,
  SelectorError,
  TimeoutError,
  getErrorMessage,
} from './errors.js';
import { USER_CLIS_DIR } from './discovery.js';
import type { IPage } from './types.js';

// ── Shared Decision Language ──────────────────────────────────────────────────
// Used by both early hints (P2) and terminal outcomes (P1).
// Keeping them unified so skill sees one continuous decision path.

export type Stage = 'explore' | 'cascade' | 'synthesize' | 'verify' | 'fallback';
export type Confidence = 'high' | 'medium' | 'low';

// ── Terminal Outcome: blocked ─────────────────────────────────────────────────
// Taxonomy by skill decision needs: "can I stop?"

export type StopReason =
  | 'no-viable-api-surface'              // no JSON API endpoints discovered
  | 'auth-too-complex'                   // requires auth beyond PUBLIC/COOKIE
  | 'no-viable-candidate'               // candidates exist but none meet quality threshold
  | 'execution-environment-unavailable'; // browser/daemon not available

// ── Terminal Outcome: needs-human-check ───────────────────────────────────────
// Taxonomy: "why escalate?" — action-oriented naming per first-principles review.

export type EscalationReason =
  | 'empty-result'               // pipeline ran but returned nothing
  | 'sparse-fields'              // result has too few populated fields
  | 'non-array-result'           // result is not an array
  | 'unsupported-required-args'  // candidate needs args we can't auto-fill
  | 'timeout'                    // execution timed out
  | 'selector-mismatch'         // DOM/JSON path didn't match
  | 'verify-inconclusive';       // catch-all for ambiguous verify failures

export type SuggestedAction =
  | 'stop'                       // nothing more to try
  | 'inspect-with-browser'       // human should use browser skill to debug
  | 'ask-for-login'              // needs human to log in
  | 'ask-for-sample-arg'         // needs human to provide a real arg value
  | 'manual-review';             // general human review needed

export type Reusability =
  | 'verified-artifact'          // fully verified, can be used directly
  | 'unverified-candidate'       // candidate exists but not verified, needs manual review
  | 'not-reusable';              // nothing worth keeping

// ── P2: Early Hint (internal cost gate) ──────────────────────────────────────
// Emitted via optional onEarlyHint callback before verify stage.
// Pure gatekeeping: does not make terminal decisions. P1 GenerateOutcome
// remains the single source of truth.

export type EarlyHintReason =
  | 'api-surface-looks-viable'
  | 'candidate-ready-for-verify'
  | 'no-viable-api-surface'
  | 'auth-too-complex'
  | 'no-viable-candidate';

export interface EarlyHint {
  stage: 'explore' | 'synthesize' | 'cascade';
  continue: boolean;
  reason: EarlyHintReason;
  confidence: Confidence;
  candidate?: {
    name: string;
    command: string;
    path: string | null;
    reusability: 'unverified-candidate' | 'not-reusable';
  };
  message?: string;
}

export type EarlyHintHandler = (hint: EarlyHint) => void;

// ── Outcome Types ─────────────────────────────────────────────────────────────

type SupportedStrategy = Strategy.PUBLIC | Strategy.COOKIE;

export interface GenerateStats {
  endpoint_count: number;
  api_endpoint_count: number;
  candidate_count: number;
  verified: boolean;
  repair_attempted: boolean;
  explore_dir: string;
}

export interface VerifiedAdapter {
  site: string;
  name: string;
  command: string;
  strategy: SupportedStrategy;
  path: string;
  metadata_path?: string;
  reusability: 'verified-artifact';
}

export interface EscalationContext {
  stage: Stage;
  reason: EscalationReason;
  confidence: Confidence;
  suggested_action: SuggestedAction;
  candidate: {
    name: string;
    command: string;
    path: string | null;
    reusability: Reusability;
  };
}

export type GenerateOutcome = {
  status: 'success' | 'blocked' | 'needs-human-check';

  // success path
  adapter?: VerifiedAdapter;

  // blocked path
  reason?: StopReason;
  stage?: Stage;
  confidence?: Confidence;

  // needs-human-check path
  escalation?: EscalationContext;

  // Explicit reusability — present on success and needs-human-check.
  // Single source of truth: skill reads this, not path or sidecar metadata.
  reusability?: Reusability;

  // human-readable summary (not the primary contract)
  message?: string;

  stats: GenerateStats;
};

export interface GenerateVerifiedOptions {
  url: string;
  BrowserFactory: new () => IBrowserFactory;
  goal?: string | null;
  site?: string;
  waitSeconds?: number;
  top?: number;
  workspace?: string;
  noRegister?: boolean;
  onEarlyHint?: EarlyHintHandler;
}

// ── Verified Artifact Metadata (sidecar) ──────────────────────────────────────

export interface VerifiedArtifactMetadata {
  artifact_kind: 'verified';
  schema_version: 1;
  source_url: string;
  goal: string | null;
  strategy: SupportedStrategy;
  verified: true;
  reusable: true;
  reusability_reason: 'verified-artifact';
}

// ── Internal Types ────────────────────────────────────────────────────────────

interface ExploreBundleLike {
  manifest: {
    site: string;
    target_url: string;
    final_url?: string;
  };
  endpoints: Array<{
    pattern: string;
    url: string;
    itemPath: string | null;
    itemCount: number;
    detectedFields: Record<string, string>;
  }>;
  capabilities: Array<{
    name: string;
    strategy: string;
    endpoint?: string;
    itemPath?: string | null;
  }>;
}

interface CandidateContext {
  capability: ExploreBundleLike['capabilities'][number] | undefined;
  endpoint: ExploreBundleLike['endpoints'][number] | null;
}

type VerifyFailureReason = 'empty-result' | 'sparse-fields' | 'non-array-result';

type VerificationResult =
  | { ok: true }
  | { ok: false; reason: VerifyFailureReason }
  | { ok: false; terminal: 'blocked' | 'needs-human-check'; reason?: StopReason; escalationReason?: EscalationReason; issue: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSupportedStrategy(value: unknown): SupportedStrategy | null {
  return value === Strategy.PUBLIC || value === Strategy.COOKIE ? value : null;
}

function commandName(site: string, name: string): string {
  return `${site}/${name}`;
}

function buildStats(args: {
  endpointCount: number;
  apiEndpointCount: number;
  candidateCount: number;
  verified?: boolean;
  repairAttempted?: boolean;
  exploreDir: string;
}): GenerateStats {
  return {
    endpoint_count: args.endpointCount,
    api_endpoint_count: args.apiEndpointCount,
    candidate_count: args.candidateCount,
    verified: args.verified ?? false,
    repair_attempted: args.repairAttempted ?? false,
    explore_dir: args.exploreDir,
  };
}

function readCandidateJson(filePath: string): CandidateYaml {
  const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CandidateYaml | null;
  if (!loaded || typeof loaded !== 'object') {
    throw new CommandExecutionError(`Generated candidate is invalid: ${filePath}`);
  }
  return loaded;
}

function chooseEndpoint(
  capability: ExploreBundleLike['capabilities'][number] | undefined,
  endpoints: ExploreBundleLike['endpoints'],
): ExploreBundleLike['endpoints'][number] | null {
  if (!endpoints.length) return null;

  if (capability?.endpoint) {
    const endpointPattern = capability.endpoint;
    const exact = endpoints.find((endpoint) => endpoint.pattern === endpointPattern || endpoint.url.includes(endpointPattern));
    if (exact) return exact;
  }

  return [...endpoints].sort((a, b) => {
    const aScore = (a.itemCount ?? 0) * 10 + Object.keys(a.detectedFields ?? {}).length;
    const bScore = (b.itemCount ?? 0) * 10 + Object.keys(b.detectedFields ?? {}).length;
    return bScore - aScore;
  })[0] ?? null;
}

function cloneCandidate(candidate: CandidateYaml): CandidateYaml {
  return JSON.parse(JSON.stringify(candidate)) as CandidateYaml;
}

function hasBrowserOnlyStep(pipeline: Record<string, unknown>[]): boolean {
  return pipeline.some((step) => {
    const op = Object.keys(step)[0];
    return op === 'navigate' || op === 'wait' || op === 'evaluate' || op === 'click' || op === 'tap' || op === 'type' || op === 'press';
  });
}

function detectBrowserFlag(candidate: CandidateYaml): boolean {
  return candidate.browser ?? hasBrowserOnlyStep(candidate.pipeline as Record<string, unknown>[]);
}

function candidateToCommand(candidate: CandidateYaml, source: string): CliCommand {
  return {
    site: candidate.site,
    name: candidate.name,
    description: candidate.description,
    domain: candidate.domain,
    strategy: parseSupportedStrategy(candidate.strategy) ?? Strategy.COOKIE,
    browser: detectBrowserFlag(candidate),
    args: Object.entries(candidate.args ?? {}).map(([name, def]) => ({
      name,
      type: def.type,
      required: def.required,
      default: def.default,
      help: def.description,
    })),
    columns: candidate.columns,
    pipeline: candidate.pipeline as Record<string, unknown>[],
    source,
  };
}

function buildDefaultArgs(candidate: CandidateYaml): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(candidate.args ?? {})) {
    if (def.default !== undefined) {
      args[name] = def.default;
      continue;
    }

    if (def.type === 'int' || def.type === 'number') {
      args[name] = name === 'page' ? 1 : 20;
      continue;
    }

    if (def.type === 'boolean' || def.type === 'bool') {
      args[name] = false;
      continue;
    }

    if (name === 'keyword' || name === 'query') {
      args[name] = 'test';
      continue;
    }

    if (def.required) args[name] = 'test';
  }
  return args;
}

function getUnsupportedVerificationArgs(candidate: CandidateYaml): string[] {
  return Object.entries(candidate.args ?? {})
    .filter(([name, def]) => {
      if (!def.required || def.default !== undefined) return false;
      if (def.type === 'int' || def.type === 'number') return false;
      if (def.type === 'boolean' || def.type === 'bool') return false;
      if (name === 'keyword' || name === 'query') return false;
      return true;
    })
    .map(([name]) => name);
}

function assessResult(result: unknown, expectedFields: string[] = []): VerificationResult {
  if (!Array.isArray(result)) return { ok: false, reason: 'non-array-result' };
  if (result.length === 0) return { ok: false, reason: 'empty-result' };

  const sample = result[0];
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return { ok: false, reason: 'sparse-fields' };
  }

  const record = sample as Record<string, unknown>;
  const keys = Object.keys(record);
  const populated = keys.filter((key) => record[key] !== null && record[key] !== undefined && record[key] !== '');
  if (populated.length < 2) return { ok: false, reason: 'sparse-fields' };

  if (expectedFields.length > 0) {
    const matched = expectedFields.filter((field) => keys.includes(field));
    if (matched.length === 0) return { ok: false, reason: 'sparse-fields' };
  }

  return { ok: true };
}

function withItemPath(candidate: CandidateYaml, itemPath: string | null): CandidateYaml | null {
  if (!itemPath) return null;

  const next = cloneCandidate(candidate);
  const selectIndex = next.pipeline.findIndex((step) => 'select' in step);
  if (selectIndex === -1) return null;

  const current = next.pipeline[selectIndex] as { select: string };
  if (current.select === itemPath) return null;
  next.pipeline[selectIndex] = { select: itemPath };
  return next;
}

function applyStrategy(candidate: CandidateYaml, strategy: SupportedStrategy): CandidateYaml {
  const next = cloneCandidate(candidate);
  next.strategy = strategy;
  if (strategy === Strategy.COOKIE) next.browser = true;
  return next;
}

// ── Escalation builders ───────────────────────────────────────────────────────

function mapVerifyFailureToEscalation(reason: VerifyFailureReason): EscalationReason {
  return reason; // VerifyFailureReason is a subset of EscalationReason
}

function suggestAction(reason: EscalationReason): SuggestedAction {
  switch (reason) {
    case 'unsupported-required-args': return 'ask-for-sample-arg';
    case 'timeout': return 'inspect-with-browser';
    case 'selector-mismatch': return 'inspect-with-browser';
    case 'empty-result': return 'inspect-with-browser';
    case 'sparse-fields': return 'inspect-with-browser';
    case 'non-array-result': return 'inspect-with-browser';
    case 'verify-inconclusive': return 'manual-review';
  }
}

function buildEscalation(
  stage: Stage,
  reason: EscalationReason,
  summary: SynthesizeCandidateSummary,
  site: string,
  opts?: { reusability?: Reusability; confidence?: Confidence },
): EscalationContext {
  return {
    stage,
    reason,
    confidence: opts?.confidence ?? 'medium',
    suggested_action: suggestAction(reason),
    candidate: {
      name: summary.name,
      command: commandName(site, summary.name),
      path: summary.path ?? null,
      reusability: opts?.reusability ?? 'unverified-candidate',
    },
  };
}

// ── Verification ──────────────────────────────────────────────────────────────

async function verifyCandidate(
  page: IPage,
  candidate: CandidateYaml,
  expectedFields: string[],
): Promise<VerificationResult> {
  try {
    const result = await executePipeline(page, candidate.pipeline as unknown[], {
      args: buildDefaultArgs(candidate),
    });
    return assessResult(result, expectedFields);
  } catch (error) {
    if (error instanceof BrowserConnectError) {
      return { ok: false, terminal: 'blocked', reason: 'execution-environment-unavailable', issue: getErrorMessage(error) };
    }
    if (error instanceof AuthRequiredError) {
      return { ok: false, terminal: 'blocked', reason: 'auth-too-complex', issue: getErrorMessage(error) };
    }
    if (error instanceof SelectorError) {
      return { ok: false, terminal: 'needs-human-check', escalationReason: 'selector-mismatch', issue: getErrorMessage(error) };
    }
    if (error instanceof TimeoutError) {
      return { ok: false, terminal: 'needs-human-check', escalationReason: 'timeout', issue: getErrorMessage(error) };
    }
    if (error instanceof CommandExecutionError) {
      return { ok: false, terminal: 'needs-human-check', escalationReason: 'verify-inconclusive', issue: getErrorMessage(error) };
    }
    return { ok: false, terminal: 'needs-human-check', escalationReason: 'verify-inconclusive', issue: getErrorMessage(error) };
  }
}

async function probeCandidateStrategy(page: IPage, endpointUrl: string): Promise<SupportedStrategy | null> {
  const { cascadeProbe } = await import('./cascade.js');
  const result = await cascadeProbe(page, endpointUrl, { maxStrategy: Strategy.COOKIE });
  const success = result.probes.find((probe) => probe.success);
  return parseSupportedStrategy(success?.strategy);
}

// ── Artifact persistence ──────────────────────────────────────────────────────

function candidateToTs(candidate: CandidateYaml): string {
  const strategyMap: Record<string, string> = {
    public: 'Strategy.PUBLIC',
    cookie: 'Strategy.COOKIE',
    header: 'Strategy.HEADER',
    intercept: 'Strategy.INTERCEPT',
    ui: 'Strategy.UI',
  };
  const stratEnum = strategyMap[candidate.strategy?.toLowerCase()] ?? 'Strategy.COOKIE';
  const browser = detectBrowserFlag(candidate);

  const argsArray = Object.entries(candidate.args ?? {}).map(([name, def]) => {
    const parts: string[] = [`name: '${name}'`];
    if (def.type && def.type !== 'str') parts.push(`type: '${def.type}'`);
    if (def.required) parts.push('required: true');
    if (def.default !== undefined) parts.push(`default: ${JSON.stringify(def.default)}`);
    if (def.description) parts.push(`help: '${def.description.replace(/'/g, "\\'")}'`);
    return `    { ${parts.join(', ')} }`;
  });

  const formatStepValue = (v: unknown): string => {
    if (typeof v === 'string') {
      if (v.includes('\n') || v.includes("'")) {
        return '`' + v.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
      }
      return `'${v.replace(/\\/g, '\\\\')}'`;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === null || v === undefined) return 'undefined';
    if (Array.isArray(v)) return `[${v.map(formatStepValue).join(', ')}]`;
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      const items = entries.map(([k, val]) => `${k}: ${formatStepValue(val)}`);
      return `{ ${items.join(', ')} }`;
    }
    return String(v);
  };

  const pipelineSteps = (candidate.pipeline ?? []).map((step) => {
    const entries = Object.entries(step as Record<string, unknown>);
    if (entries.length === 1) {
      const [op, value] = entries[0];
      return `    { ${op}: ${formatStepValue(value)} }`;
    }
    return `    ${formatStepValue(step)}`;
  });

  const lines: string[] = [];
  lines.push("import { cli, Strategy } from '@jackwener/opencli/registry';");
  lines.push('');
  lines.push('cli({');
  lines.push(`  site: '${candidate.site}',`);
  lines.push(`  name: '${candidate.name}',`);
  if (candidate.description) lines.push(`  description: '${candidate.description.replace(/'/g, "\\'")}',`);
  if (candidate.domain) lines.push(`  domain: '${candidate.domain}',`);
  lines.push(`  strategy: ${stratEnum},`);
  lines.push(`  browser: ${browser},`);
  if (argsArray.length > 0) {
    lines.push(`  args: [`);
    lines.push(argsArray.join(',\n') + ',');
    lines.push('  ],');
  }
  if (candidate.columns?.length) {
    lines.push(`  columns: [${candidate.columns.map(c => `'${c}'`).join(', ')}],`);
  }
  if (pipelineSteps.length > 0) {
    lines.push('  pipeline: [');
    lines.push(pipelineSteps.join(',\n') + ',');
    lines.push('  ],');
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

async function registerVerifiedAdapter(candidate: CandidateYaml, metadata: VerifiedArtifactMetadata): Promise<{ adapterPath: string; metadataPath: string }> {
  const siteDir = path.join(USER_CLIS_DIR, candidate.site);
  const adapterPath = path.join(siteDir, `${candidate.name}.ts`);
  const metadataPath = path.join(siteDir, `${candidate.name}.meta.json`);
  await fs.promises.mkdir(siteDir, { recursive: true });
  await fs.promises.writeFile(adapterPath, candidateToTs(candidate));
  await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  registerCommand(candidateToCommand(candidate, adapterPath));
  return { adapterPath, metadataPath };
}

async function writeVerifiedArtifact(candidate: CandidateYaml, exploreDir: string, metadata: VerifiedArtifactMetadata): Promise<{ adapterPath: string; metadataPath: string }> {
  const outDir = path.join(exploreDir, 'verified');
  const adapterPath = path.join(outDir, `${candidate.name}.verified.ts`);
  const metadataPath = path.join(outDir, `${candidate.name}.verified.meta.json`);
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.writeFile(adapterPath, candidateToTs(candidate));
  await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  return { adapterPath, metadataPath };
}

// ── Session error classification ──────────────────────────────────────────────

function classifySessionError(
  error: unknown,
  summary: SynthesizeCandidateSummary,
  stats: GenerateStats,
  site: string,
): GenerateOutcome {
  if (error instanceof BrowserConnectError) {
    return {
      status: 'blocked',
      reason: 'execution-environment-unavailable',
      stage: 'verify',
      confidence: 'high',
      message: getErrorMessage(error),
      stats,
    };
  }
  if (error instanceof AuthRequiredError) {
    return {
      status: 'blocked',
      reason: 'auth-too-complex',
      stage: 'verify',
      confidence: 'high',
      message: getErrorMessage(error),
      stats,
    };
  }
  return {
    status: 'needs-human-check',
    escalation: buildEscalation('verify', 'verify-inconclusive', summary, site, {
      reusability: 'unverified-candidate',
      confidence: 'low',
    }),
    reusability: 'unverified-candidate',
    message: getErrorMessage(error),
    stats,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function generateVerifiedFromUrl(opts: GenerateVerifiedOptions): Promise<GenerateOutcome> {
  const normalizedGoal = normalizeGoal(opts.goal) ?? opts.goal ?? undefined;
  const exploreResult = await exploreUrl(opts.url, {
    BrowserFactory: opts.BrowserFactory,
    site: opts.site,
    goal: normalizedGoal,
    waitSeconds: opts.waitSeconds ?? 3,
    workspace: opts.workspace,
  });

  const bundle = loadExploreBundle(exploreResult.out_dir) as ExploreBundleLike;
  const synthesizeResult = synthesizeFromExplore(exploreResult.out_dir, { top: opts.top ?? 3 });
  const selected = selectCandidate(synthesizeResult.candidates ?? [], opts.goal);

  const baseStats = buildStats({
    endpointCount: exploreResult.endpoint_count,
    apiEndpointCount: exploreResult.api_endpoint_count,
    candidateCount: synthesizeResult.candidate_count,
    exploreDir: exploreResult.out_dir,
  });

  // ── Early hint: explore result ──────────────────────────────────────────
  if (exploreResult.api_endpoint_count === 0) {
    opts.onEarlyHint?.({
      stage: 'explore',
      continue: false,
      reason: 'no-viable-api-surface',
      confidence: 'high',
    });
    return {
      status: 'blocked',
      reason: 'no-viable-api-surface',
      stage: 'explore',
      confidence: 'high',
      message: 'No JSON API endpoints discovered on this site.',
      stats: baseStats,
    };
  }
  opts.onEarlyHint?.({
    stage: 'explore',
    continue: true,
    reason: 'api-surface-looks-viable',
    confidence: 'medium',
  });

  // ── Early hint: synthesize result ───────────────────────────────────────
  if (!selected || synthesizeResult.candidate_count === 0) {
    opts.onEarlyHint?.({
      stage: 'synthesize',
      continue: false,
      reason: 'no-viable-candidate',
      confidence: 'high',
    });
    return {
      status: 'blocked',
      reason: 'no-viable-candidate',
      stage: 'synthesize',
      confidence: 'high',
      message: 'No candidate met the quality threshold for verification.',
      stats: baseStats,
    };
  }

  const context: CandidateContext = {
    capability: bundle.capabilities.find((capability) => capability.name === selected.name),
    endpoint: chooseEndpoint(bundle.capabilities.find((capability) => capability.name === selected.name), bundle.endpoints),
  };

  if (!context.endpoint) {
    opts.onEarlyHint?.({
      stage: 'synthesize',
      continue: false,
      reason: 'no-viable-candidate',
      confidence: 'medium',
    });
    return {
      status: 'blocked',
      reason: 'no-viable-candidate',
      stage: 'synthesize',
      confidence: 'medium',
      message: 'No endpoint could be matched to the selected candidate.',
      stats: baseStats,
    };
  }

  const expectedFields = Object.keys(context.endpoint.detectedFields ?? {});
  const originalCandidate = readCandidateJson(selected.path);
  const unsupportedArgs = getUnsupportedVerificationArgs(originalCandidate);

  // ── Escalation: unsupported required args ───────────────────────────────
  // Note: unsupported-required-args goes directly to P1 terminal.
  // No P2 hint is emitted — this is a P1-only decision per design guardrail.
  if (unsupportedArgs.length > 0) {
    return {
      status: 'needs-human-check',
      escalation: buildEscalation('synthesize', 'unsupported-required-args', selected, bundle.manifest.site, {
        reusability: 'unverified-candidate',
        confidence: 'high',
      }),
      reusability: 'unverified-candidate',
      message: `Auto-verification does not support required args: ${unsupportedArgs.join(', ')}`,
      stats: baseStats,
    };
  }

  opts.onEarlyHint?.({
    stage: 'synthesize',
    continue: true,
    reason: 'candidate-ready-for-verify',
    confidence: 'high',
    candidate: {
      name: selected.name,
      command: commandName(bundle.manifest.site, selected.name),
      path: selected.path ?? null,
      reusability: 'unverified-candidate',
    },
  });

  // ── Phase 3: single browser session (probe + verify + repair) ───────────
  try {
    return await browserSession(opts.BrowserFactory, async (page) => {
      await page.goto(bundle.manifest.final_url ?? bundle.manifest.target_url);

      // ── Probe: candidate-bound strategy ─────────────────────────────────
      const bestStrategy = await probeCandidateStrategy(page, context.endpoint!.url);
      if (!bestStrategy) {
        opts.onEarlyHint?.({
          stage: 'cascade',
          continue: false,
          reason: 'auth-too-complex',
          confidence: 'high',
        });
        return {
              status: 'blocked',
          reason: 'auth-too-complex' as StopReason,
          stage: 'cascade' as Stage,
          confidence: 'high' as Confidence,
          message: 'No PUBLIC or COOKIE strategy succeeded for this endpoint.',
          stats: baseStats,
        };
      }

      opts.onEarlyHint?.({
        stage: 'cascade',
        continue: true,
        reason: 'candidate-ready-for-verify',
        confidence: 'high',
        candidate: {
          name: selected.name,
          command: commandName(bundle.manifest.site, selected.name),
          path: selected.path ?? null,
          reusability: 'unverified-candidate',
        },
      });

      const candidate = applyStrategy(originalCandidate, bestStrategy);
      const goalStr = normalizedGoal ?? opts.goal ?? null;
      const buildMetadata = (): VerifiedArtifactMetadata => ({
        artifact_kind: 'verified',
        schema_version: 1,
        source_url: opts.url,
        goal: goalStr,
        strategy: bestStrategy,
        verified: true,
        reusable: true,
        reusability_reason: 'verified-artifact',
      });

      // ── First verify attempt ────────────────────────────────────────────
      const firstAttempt = await verifyCandidate(page, candidate, expectedFields);
      if (firstAttempt.ok) {
        const artifact = opts.noRegister
          ? await writeVerifiedArtifact(candidate, exploreResult.out_dir, buildMetadata())
          : await registerVerifiedAdapter(candidate, buildMetadata());
        return {
              status: 'success' as const,
          adapter: {
            site: candidate.site,
            name: candidate.name,
            command: commandName(candidate.site, candidate.name),
            strategy: bestStrategy,
            path: artifact.adapterPath,
            metadata_path: artifact.metadataPath,
            reusability: 'verified-artifact',
          },
          reusability: 'verified-artifact',
          stats: buildStats({
            endpointCount: exploreResult.endpoint_count,
            apiEndpointCount: exploreResult.api_endpoint_count,
            candidateCount: synthesizeResult.candidate_count,
            verified: true,
            repairAttempted: false,
            exploreDir: exploreResult.out_dir,
          }),
        };
      }

      // ── Terminal from first attempt ─────────────────────────────────────
      if ('terminal' in firstAttempt) {
        if (firstAttempt.terminal === 'blocked') {
          return {
                  status: 'blocked',
            reason: firstAttempt.reason ?? 'execution-environment-unavailable',
            stage: 'verify' as Stage,
            confidence: 'high' as Confidence,
            message: firstAttempt.issue,
            stats: baseStats,
          };
        }
        return {
              status: 'needs-human-check',
          escalation: buildEscalation(
            'verify',
            firstAttempt.escalationReason ?? 'verify-inconclusive',
            selected,
            bundle.manifest.site,
            { reusability: 'unverified-candidate', confidence: 'medium' },
          ),
          reusability: 'unverified-candidate',
          message: firstAttempt.issue,
          stats: baseStats,
        };
      }

      // ── Bounded repair: itemPath relocation ─────────────────────────────
      const repaired = firstAttempt.reason === 'empty-result'
        ? withItemPath(candidate, context.endpoint?.itemPath ?? null)
        : null;

      if (!repaired) {
        const escalationReason = mapVerifyFailureToEscalation(firstAttempt.reason);
        return {
              status: 'needs-human-check',
          escalation: buildEscalation('verify', escalationReason, selected, bundle.manifest.site, {
            reusability: 'unverified-candidate',
            confidence: 'medium',
          }),
          reusability: 'unverified-candidate',
          message: `Verification failed: ${firstAttempt.reason}`,
          stats: buildStats({
            endpointCount: exploreResult.endpoint_count,
            apiEndpointCount: exploreResult.api_endpoint_count,
            candidateCount: synthesizeResult.candidate_count,
            repairAttempted: firstAttempt.reason === 'empty-result',
            exploreDir: exploreResult.out_dir,
          }),
        };
      }

      // ── Second verify attempt (after repair) ───────────────────────────
      const secondAttempt = await verifyCandidate(page, repaired, expectedFields);
      const repairedStats = buildStats({
        endpointCount: exploreResult.endpoint_count,
        apiEndpointCount: exploreResult.api_endpoint_count,
        candidateCount: synthesizeResult.candidate_count,
        repairAttempted: true,
        exploreDir: exploreResult.out_dir,
      });

      if (secondAttempt.ok) {
        const artifact = opts.noRegister
          ? await writeVerifiedArtifact(repaired, exploreResult.out_dir, buildMetadata())
          : await registerVerifiedAdapter(repaired, buildMetadata());
        return {
              status: 'success' as const,
          adapter: {
            site: repaired.site,
            name: repaired.name,
            command: commandName(repaired.site, repaired.name),
            strategy: bestStrategy,
            path: artifact.adapterPath,
            metadata_path: artifact.metadataPath,
            reusability: 'verified-artifact',
          },
          reusability: 'verified-artifact',
          stats: { ...repairedStats, verified: true },
        };
      }

      if ('terminal' in secondAttempt) {
        if (secondAttempt.terminal === 'blocked') {
          return {
                  status: 'blocked',
            reason: secondAttempt.reason ?? 'execution-environment-unavailable',
            stage: 'fallback' as Stage,
            confidence: 'high' as Confidence,
            message: secondAttempt.issue,
            stats: repairedStats,
          };
        }
        return {
              status: 'needs-human-check',
          escalation: buildEscalation(
            'fallback',
            secondAttempt.escalationReason ?? 'verify-inconclusive',
            selected,
            bundle.manifest.site,
            { reusability: 'unverified-candidate', confidence: 'low' },
          ),
          reusability: 'unverified-candidate',
          message: secondAttempt.issue,
          stats: repairedStats,
        };
      }

      // ── Repair exhausted ────────────────────────────────────────────────
      const escalationReason = mapVerifyFailureToEscalation(secondAttempt.reason);
      return {
          status: 'needs-human-check',
        escalation: buildEscalation('fallback', escalationReason, selected, bundle.manifest.site, {
          reusability: 'unverified-candidate',
          confidence: 'low',
        }),
        reusability: 'unverified-candidate',
        message: `Repair exhausted: ${secondAttempt.reason}`,
        stats: repairedStats,
      };
    }, { workspace: opts.workspace });
  } catch (error) {
    return classifySessionError(error, selected, baseStats, bundle.manifest.site);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

export function renderGenerateVerifiedSummary(result: GenerateOutcome): string {
  const lines = [
    `opencli generate: ${result.status.toUpperCase()}`,
  ];

  if (result.status === 'success' && result.adapter) {
    lines.push(`Command: ${result.adapter.command}`);
    lines.push(`Strategy: ${result.adapter.strategy}`);
    lines.push(`Path: ${result.adapter.path}`);
  } else if (result.status === 'blocked') {
    lines.push(`Reason: ${result.reason}`);
    lines.push(`Stage: ${result.stage}`);
    lines.push(`Confidence: ${result.confidence}`);
    if (result.message) lines.push(`Message: ${result.message}`);
  } else if (result.status === 'needs-human-check' && result.escalation) {
    lines.push(`Stage: ${result.escalation.stage}`);
    lines.push(`Reason: ${result.escalation.reason}`);
    lines.push(`Suggested action: ${result.escalation.suggested_action}`);
    lines.push(`Candidate: ${result.escalation.candidate.command}`);
    lines.push(`Reusability: ${result.escalation.candidate.reusability}`);
    if (result.message) lines.push(`Message: ${result.message}`);
  }

  lines.push('');
  lines.push(`Explore: ${result.stats.endpoint_count} endpoints, ${result.stats.api_endpoint_count} API`);
  lines.push(`Candidates: ${result.stats.candidate_count}`);
  lines.push(`Verified: ${result.stats.verified ? 'yes' : 'no'}`);
  lines.push(`Repair attempted: ${result.stats.repair_attempted ? 'yes' : 'no'}`);

  return lines.join('\n');
}
