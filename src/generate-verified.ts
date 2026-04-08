/**
 * Verified adapter generation: explore → cascade → synthesize → verify → repair → register.
 *
 * v1 scope intentionally stays narrow:
 *   - auth: public + cookie only
 *   - capability: read-only commands
 *   - site shape: discoverable JSON endpoints with structured array responses
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { exploreUrl } from './explore.js';
import { loadExploreBundle, synthesizeFromExplore, type CandidateYaml, type SynthesizeCandidateSummary } from './synthesize.js';
import { normalizeGoal, selectCandidate } from './generate.js';
import { browserSession } from './runtime.js';
import type { IBrowserFactory } from './runtime.js';
import { executeCommand } from './execution.js';
import { registerCommand, Strategy, type CliCommand, type CommandArgs } from './registry.js';
import {
  BrowserConnectError,
  AuthRequiredError,
  TimeoutError,
  CommandExecutionError,
  getErrorMessage,
} from './errors.js';
import { USER_CLIS_DIR } from './discovery.js';

type SupportedStrategy = Strategy.PUBLIC | Strategy.COOKIE;
type VerifyFailureReason = 'empty-result' | 'sparse-fields' | 'non-array-result';

export type BlockReason =
  | 'no-api-discovered'
  | 'html-only'
  | 'auth-required'
  | 'no-viable-candidate'
  | 'browser-unavailable'
  | 'cascade-failed';

export interface GenerateStats {
  endpoint_count: number;
  api_endpoint_count: number;
  candidate_count: number;
  verified_candidates: number;
  repair_attempts: number;
  best_strategy: SupportedStrategy | null;
  registered: boolean;
  explore_dir: string;
}

export interface VerifiedAdapter {
  site: string;
  name: string;
  command: string;
  strategy: SupportedStrategy;
  path?: string;
}

export interface CandidateInfo {
  site: string;
  name: string;
  command: string;
  strategy: string;
  path: string;
}

export type GenerateOutcome =
  | { status: 'success'; adapter: VerifiedAdapter; stats: GenerateStats }
  | { status: 'blocked'; reason: BlockReason; stats: GenerateStats }
  | { status: 'needs-human-check'; candidate: CandidateInfo; issue: string; stats: GenerateStats };

export interface GenerateVerifiedOptions {
  url: string;
  BrowserFactory: new () => IBrowserFactory;
  goal?: string | null;
  site?: string;
  waitSeconds?: number;
  top?: number;
  workspace?: string;
  noRegister?: boolean;
}

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

interface VerificationSuccess {
  ok: true;
}

interface VerificationFailure {
  ok: false;
  reason: VerifyFailureReason;
}

interface VerificationTerminal {
  ok: false;
  terminal: 'blocked' | 'needs-human-check';
  reason?: BlockReason;
  issue: string;
}

type VerificationResult = VerificationSuccess | VerificationFailure | VerificationTerminal;

interface CandidateContext {
  summary: SynthesizeCandidateSummary;
  capability: ExploreBundleLike['capabilities'][number] | undefined;
  endpoint: ExploreBundleLike['endpoints'][number] | null;
}

function cloneCandidate(candidate: CandidateYaml): CandidateYaml {
  return JSON.parse(JSON.stringify(candidate)) as CandidateYaml;
}

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
  verifiedCandidates?: number;
  repairAttempts?: number;
  bestStrategy?: SupportedStrategy | null;
  registered?: boolean;
  exploreDir: string;
}): GenerateStats {
  return {
    endpoint_count: args.endpointCount,
    api_endpoint_count: args.apiEndpointCount,
    candidate_count: args.candidateCount,
    verified_candidates: args.verifiedCandidates ?? 0,
    repair_attempts: args.repairAttempts ?? 0,
    best_strategy: args.bestStrategy ?? null,
    registered: args.registered ?? false,
    explore_dir: args.exploreDir,
  };
}

function buildCandidateInfo(site: string, summary: SynthesizeCandidateSummary): CandidateInfo {
  return {
    site,
    name: summary.name,
    command: commandName(site, summary.name),
    strategy: summary.strategy,
    path: summary.path,
  };
}

function chooseEndpoint(
  capability: ExploreBundleLike['capabilities'][number] | undefined,
  endpoints: ExploreBundleLike['endpoints'],
): ExploreBundleLike['endpoints'][number] | null {
  if (!endpoints.length) return null;

  if (capability?.endpoint) {
    const exact = endpoints.find((endpoint) => endpoint.pattern === capability.endpoint || endpoint.url.includes(capability.endpoint!));
    if (exact) return exact;
  }

  return [...endpoints].sort((a, b) => {
    const aScore = (a.itemCount ?? 0) * 10 + Object.keys(a.detectedFields ?? {}).length;
    const bScore = (b.itemCount ?? 0) * 10 + Object.keys(b.detectedFields ?? {}).length;
    return bScore - aScore;
  })[0] ?? null;
}

function orderCandidates(
  site: string,
  candidates: SynthesizeCandidateSummary[],
  goal?: string | null,
): SynthesizeCandidateSummary[] {
  const selected = selectCandidate(candidates, goal);
  if (!selected) return [];
  return [selected, ...candidates.filter((candidate) => candidate.path !== selected.path)];
}

function readCandidateYaml(filePath: string): CandidateYaml {
  const loaded = yaml.load(fs.readFileSync(filePath, 'utf-8')) as CandidateYaml | null;
  if (!loaded || typeof loaded !== 'object') {
    throw new CommandExecutionError(`Generated candidate is invalid: ${filePath}`);
  }
  return loaded;
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

function buildDefaultArgs(candidate: CandidateYaml): CommandArgs {
  const args: CommandArgs = {};
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

    if (def.required) {
      args[name] = 'test';
    }
  }
  return args;
}

function assessResult(result: unknown): VerificationSuccess | VerificationFailure {
  if (!Array.isArray(result)) return { ok: false, reason: 'non-array-result' };
  if (result.length === 0) return { ok: false, reason: 'empty-result' };

  const sample = result[0];
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return { ok: false, reason: 'sparse-fields' };
  }

  const populatedFields = Object.values(sample as Record<string, unknown>)
    .filter((value) => value !== null && value !== undefined && value !== '')
    .length;

  return populatedFields >= 2
    ? { ok: true }
    : { ok: false, reason: 'sparse-fields' };
}

function buildEvaluateScript(url: string, itemPath: string | null, detectedFields: Record<string, string>): string {
  const pathChain = itemPath
    ? itemPath.split('.').map((segment) => `?.${segment}`).join('')
    : '';

  const mappings = Object.entries(detectedFields)
    .map(([role, field]) => `      ${role}: item${String(field).split('.').map((segment) => `?.${segment}`).join('')}`)
    .join(',\n');

  const mapCode = mappings
    ? `.map((item) => ({\n${mappings}\n    }))`
    : '';

  return [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });`,
    '  const data = await res.json();',
    `  return (data${pathChain} || [])${mapCode};`,
    '})()\n',
  ].join('\n');
}

function getMapStep(candidate: CandidateYaml): Record<string, string> | null {
  const mapStep = candidate.pipeline.find((step) => 'map' in step) as { map: Record<string, string> } | undefined;
  return mapStep?.map ?? null;
}

function rebuildMapStep(candidate: CandidateYaml, endpoint: CandidateContext['endpoint']): Record<string, string> | null {
  if (!endpoint) return null;

  const columns = candidate.columns ?? Object.keys(getMapStep(candidate) ?? {}).filter((column) => column !== 'rank');
  if (columns.length === 0) return null;

  const nextMap: Record<string, string> = {};
  const hasKeywordArg = Object.prototype.hasOwnProperty.call(candidate.args ?? {}, 'keyword');
  if (!hasKeywordArg) nextMap.rank = '${{ index + 1 }}';

  for (const column of columns) {
    const fieldPath = endpoint.detectedFields?.[column];
    nextMap[column] = fieldPath ? `\${{ item.${fieldPath} }}` : `\${{ item.${column} }}`;
  }

  return nextMap;
}

function withMapStep(candidate: CandidateYaml, map: Record<string, string>): CandidateYaml {
  const next = cloneCandidate(candidate);
  const index = next.pipeline.findIndex((step) => 'map' in step);
  if (index === -1) next.pipeline.push({ map });
  else next.pipeline[index] = { map };
  return next;
}

function withItemPath(candidate: CandidateYaml, targetUrl: string, endpoint: CandidateContext['endpoint'], strategy: SupportedStrategy): CandidateYaml | null {
  if (!endpoint) return null;

  const next = cloneCandidate(candidate);
  const fetchIndex = next.pipeline.findIndex((step) => 'fetch' in step);
  const selectIndex = next.pipeline.findIndex((step) => 'select' in step);
  const evaluateIndex = next.pipeline.findIndex((step) => 'evaluate' in step);

  if (strategy === Strategy.COOKIE && fetchIndex !== -1) {
    const fetchStep = next.pipeline[fetchIndex] as { fetch: { url: string } };
    const mapStep = next.pipeline.find((step) => 'map' in step);
    const limitStep = next.pipeline.find((step) => 'limit' in step);
    next.pipeline = [
      { navigate: targetUrl },
      { evaluate: buildEvaluateScript(fetchStep.fetch.url, endpoint.itemPath, endpoint.detectedFields ?? {}) },
      ...(mapStep ? [mapStep] : []),
      ...(limitStep ? [limitStep] : []),
    ];
    next.browser = true;
    next.strategy = Strategy.COOKIE;
    return next;
  }

  if (selectIndex !== -1 && endpoint.itemPath) {
    const current = next.pipeline[selectIndex] as { select: string };
    if (current.select !== endpoint.itemPath) {
      next.pipeline[selectIndex] = { select: endpoint.itemPath };
      return next;
    }
  }

  if (evaluateIndex !== -1) {
    const evaluateUrl =
      ((next.pipeline.find((step) => 'fetch' in step) as { fetch?: { url?: string } } | undefined)?.fetch?.url)
      ?? endpoint.url;
    const nextScript = buildEvaluateScript(evaluateUrl, endpoint.itemPath, endpoint.detectedFields ?? {});
    const current = next.pipeline[evaluateIndex] as { evaluate: string };
    if (current.evaluate !== nextScript) {
      next.pipeline[evaluateIndex] = { evaluate: nextScript };
      return next;
    }
  }

  return null;
}

function repairCandidate(
  candidate: CandidateYaml,
  context: CandidateContext,
  reason: VerifyFailureReason,
  strategy: SupportedStrategy,
  targetUrl: string,
): CandidateYaml | null {
  if (reason === 'empty-result') {
    return withItemPath(candidate, targetUrl, context.endpoint, strategy);
  }

  if (reason === 'sparse-fields') {
    const nextMap = rebuildMapStep(candidate, context.endpoint);
    if (!nextMap) return null;
    const currentMap = getMapStep(candidate);
    if (JSON.stringify(currentMap) === JSON.stringify(nextMap)) return null;
    return withMapStep(candidate, nextMap);
  }

  return null;
}

async function verifyCandidate(candidate: CandidateYaml): Promise<VerificationResult> {
  try {
    const cmd = candidateToCommand(candidate, 'generate-verified:temp');
    const result = await executeCommand(cmd, buildDefaultArgs(candidate), false);
    return assessResult(result);
  } catch (error) {
    if (error instanceof BrowserConnectError) {
      return { ok: false, terminal: 'blocked', reason: 'browser-unavailable', issue: getErrorMessage(error) };
    }
    if (error instanceof AuthRequiredError) {
      return { ok: false, terminal: 'blocked', reason: 'auth-required', issue: getErrorMessage(error) };
    }
    if (error instanceof TimeoutError) {
      return { ok: false, terminal: 'needs-human-check', issue: getErrorMessage(error) };
    }
    if (error instanceof CommandExecutionError) {
      return { ok: false, terminal: 'needs-human-check', issue: getErrorMessage(error) };
    }
    return { ok: false, terminal: 'needs-human-check', issue: getErrorMessage(error) };
  }
}

async function probeBestStrategy(
  url: string,
  finalUrl: string,
  endpointUrl: string,
  BrowserFactory: new () => IBrowserFactory,
  workspace?: string,
): Promise<SupportedStrategy | null> {
  const { cascadeProbe } = await import('./cascade.js');
  const result = await browserSession(BrowserFactory, async (page) => {
    await page.goto(finalUrl || url);
    return cascadeProbe(page, endpointUrl, { maxStrategy: Strategy.COOKIE });
  }, { workspace });

  const success = result.probes.find((probe) => probe.success);
  return parseSupportedStrategy(success?.strategy);
}

async function registerVerifiedAdapter(candidate: CandidateYaml): Promise<string> {
  const siteDir = path.join(USER_CLIS_DIR, candidate.site);
  const filePath = path.join(siteDir, `${candidate.name}.yaml`);
  await fs.promises.mkdir(siteDir, { recursive: true });
  await fs.promises.writeFile(filePath, yaml.dump(candidate, { sortKeys: false, lineWidth: 120 }));
  registerCommand(candidateToCommand(candidate, filePath));
  return filePath;
}

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
  const candidateCountBeforeSynthesize = 0;
  const baseStats = buildStats({
    endpointCount: exploreResult.endpoint_count,
    apiEndpointCount: exploreResult.api_endpoint_count,
    candidateCount: candidateCountBeforeSynthesize,
    exploreDir: exploreResult.out_dir,
  });

  if (exploreResult.endpoint_count === 0) {
    return { status: 'blocked', reason: 'no-api-discovered', stats: baseStats };
  }

  if (exploreResult.api_endpoint_count === 0) {
    return { status: 'blocked', reason: 'html-only', stats: baseStats };
  }

  const topEndpoint = bundle.endpoints[0] ?? null;
  if (!topEndpoint) {
    return { status: 'blocked', reason: 'no-api-discovered', stats: baseStats };
  }

  const bestStrategy = await probeBestStrategy(
    opts.url,
    exploreResult.final_url,
    topEndpoint.url,
    opts.BrowserFactory,
    opts.workspace,
  );

  if (!bestStrategy) {
    return {
      status: 'blocked',
      reason: 'auth-required',
      stats: buildStats({
        endpointCount: exploreResult.endpoint_count,
        apiEndpointCount: exploreResult.api_endpoint_count,
        candidateCount: candidateCountBeforeSynthesize,
        bestStrategy: null,
        exploreDir: exploreResult.out_dir,
      }),
    };
  }

  const synthesizeResult = synthesizeFromExplore(exploreResult.out_dir, { top: opts.top ?? 3 });
  if (synthesizeResult.candidate_count === 0) {
    return {
      status: 'blocked',
      reason: 'no-viable-candidate',
      stats: buildStats({
        endpointCount: exploreResult.endpoint_count,
        apiEndpointCount: exploreResult.api_endpoint_count,
        candidateCount: 0,
        bestStrategy,
        exploreDir: exploreResult.out_dir,
      }),
    };
  }

  const candidates = orderCandidates(bundle.manifest.site, synthesizeResult.candidates, opts.goal);
  let verifiedCandidates = 0;
  let repairAttempts = 0;
  let lastIssue = 'verification failed';
  let lastCandidate = candidates[0];

  for (const summary of candidates.slice(0, 3)) {
    lastCandidate = summary;
    const candidate = readCandidateYaml(summary.path);
    const context: CandidateContext = {
      summary,
      capability: bundle.capabilities.find((capability) => capability.name === summary.name),
      endpoint: chooseEndpoint(bundle.capabilities.find((capability) => capability.name === summary.name), bundle.endpoints),
    };

    let working = cloneCandidate(candidate);
    working.strategy = bestStrategy;
    if (bestStrategy === Strategy.COOKIE && !detectBrowserFlag(working)) {
      const upgraded = withItemPath(working, bundle.manifest.final_url ?? bundle.manifest.target_url, context.endpoint, bestStrategy);
      if (upgraded) working = upgraded;
    }

    const firstAttempt = await verifyCandidate(working);
    verifiedCandidates += 1;

    if (firstAttempt.ok) {
      let filePath: string | undefined;
      let registered = false;
      if (!opts.noRegister) {
        filePath = await registerVerifiedAdapter(working);
        registered = true;
      }
      return {
        status: 'success',
        adapter: {
          site: working.site,
          name: working.name,
          command: commandName(working.site, working.name),
          strategy: bestStrategy,
          ...(filePath ? { path: filePath } : {}),
        },
        stats: buildStats({
          endpointCount: exploreResult.endpoint_count,
          apiEndpointCount: exploreResult.api_endpoint_count,
          candidateCount: synthesizeResult.candidate_count,
          verifiedCandidates,
          repairAttempts,
          bestStrategy,
          registered,
          exploreDir: exploreResult.out_dir,
        }),
      };
    }

    if ('terminal' in firstAttempt) {
      if (firstAttempt.terminal === 'blocked') {
        return {
          status: 'blocked',
          reason: firstAttempt.reason ?? 'cascade-failed',
          stats: buildStats({
            endpointCount: exploreResult.endpoint_count,
            apiEndpointCount: exploreResult.api_endpoint_count,
            candidateCount: synthesizeResult.candidate_count,
            verifiedCandidates,
            repairAttempts,
            bestStrategy,
            exploreDir: exploreResult.out_dir,
          }),
        };
      }
      lastIssue = firstAttempt.issue;
      continue;
    }

    const repaired = repairCandidate(
      working,
      context,
      firstAttempt.reason,
      bestStrategy,
      bundle.manifest.final_url ?? bundle.manifest.target_url,
    );
    if (!repaired) {
      lastIssue = firstAttempt.reason;
      continue;
    }

    repairAttempts += 1;
    const secondAttempt = await verifyCandidate(repaired);
    verifiedCandidates += 1;

    if (secondAttempt.ok) {
      let filePath: string | undefined;
      let registered = false;
      if (!opts.noRegister) {
        filePath = await registerVerifiedAdapter(repaired);
        registered = true;
      }
      return {
        status: 'success',
        adapter: {
          site: repaired.site,
          name: repaired.name,
          command: commandName(repaired.site, repaired.name),
          strategy: bestStrategy,
          ...(filePath ? { path: filePath } : {}),
        },
        stats: buildStats({
          endpointCount: exploreResult.endpoint_count,
          apiEndpointCount: exploreResult.api_endpoint_count,
          candidateCount: synthesizeResult.candidate_count,
          verifiedCandidates,
          repairAttempts,
          bestStrategy,
          registered,
          exploreDir: exploreResult.out_dir,
        }),
      };
    }

    lastIssue = 'terminal' in secondAttempt
      ? secondAttempt.issue
      : secondAttempt.reason;
  }

  return {
    status: 'needs-human-check',
    candidate: buildCandidateInfo(bundle.manifest.site, lastCandidate),
    issue: lastIssue,
    stats: buildStats({
      endpointCount: exploreResult.endpoint_count,
      apiEndpointCount: exploreResult.api_endpoint_count,
      candidateCount: synthesizeResult.candidate_count,
      verifiedCandidates,
      repairAttempts,
      bestStrategy,
      exploreDir: exploreResult.out_dir,
    }),
  };
}

export function renderGenerateVerifiedSummary(result: GenerateOutcome): string {
  const lines = [
    `opencli generate: ${result.status.toUpperCase()}`,
  ];

  if (result.status === 'success') {
    lines.push(`Command: ${result.adapter.command}`);
    lines.push(`Strategy: ${result.adapter.strategy}`);
    if (result.adapter.path) lines.push(`Path: ${result.adapter.path}`);
  } else if (result.status === 'blocked') {
    lines.push(`Reason: ${result.reason}`);
  } else {
    lines.push(`Candidate: ${result.candidate.command}`);
    lines.push(`Issue: ${result.issue}`);
  }

  lines.push('');
  lines.push(`Explore: ${result.stats.endpoint_count} endpoints, ${result.stats.api_endpoint_count} API`);
  lines.push(`Candidates: ${result.stats.candidate_count}, verified attempts: ${result.stats.verified_candidates}`);
  lines.push(`Repairs: ${result.stats.repair_attempts}`);
  if (result.stats.best_strategy) lines.push(`Best strategy: ${result.stats.best_strategy}`);

  return lines.join('\n');
}
