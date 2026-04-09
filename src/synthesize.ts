/**
 * Synthesize candidate CLIs from explore artifacts.
 * Generates evaluate-based pipelines (matching hand-written adapter patterns).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { VOLATILE_PARAMS, SEARCH_PARAMS, LIMIT_PARAMS, PAGINATION_PARAMS } from './constants.js';
import type { ExploreAuthSummary, ExploreEndpointArtifact, ExploreManifest } from './explore.js';


interface RecommendedArg {
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

interface StoreHint {
  store: string;
  action: string;
}

export interface SynthesizeCapability {
  name: string;
  description: string;
  strategy: string;
  endpoint?: string;
  itemPath?: string | null;
  recommendedColumns?: string[];
  recommendedArgs?: RecommendedArg[];
  storeHint?: StoreHint;
}

export interface GeneratedArgDefinition {
  type: string;
  required?: boolean;
  default?: unknown;
  description?: string;
}

type CandidatePipelineStep =
  | { navigate: string }
  | { wait: number }
  | { evaluate: string }
  | { select: string }
  | { map: Record<string, string> }
  | { limit: string }
  | { fetch: { url: string } }
  | { tap: { store: string; action: string; timeout: number; capture?: string; select?: string | null } };

export interface CandidateYaml {
  site: string;
  name: string;
  description: string;
  domain: string;
  strategy: string;
  browser: boolean;
  args: Record<string, GeneratedArgDefinition>;
  pipeline: CandidatePipelineStep[];
  columns: string[];
}

export interface SynthesizeCandidateSummary {
  name: string;
  path: string;
  strategy: string;
}

export interface SynthesizeResult {
  site: string;
  explore_dir: string;
  out_dir: string;
  candidate_count: number;
  candidates: SynthesizeCandidateSummary[];
}

type ExploreManifestLike = Pick<ExploreManifest, 'target_url' | 'final_url'> & Partial<ExploreManifest>;
interface LoadedExploreBundle {
  manifest: ExploreManifest;
  endpoints: ExploreEndpointArtifact[];
  capabilities: SynthesizeCapability[];
  auth: ExploreAuthSummary;
}

export function synthesizeFromExplore(
  target: string,
  opts: { outDir?: string; top?: number } = {},
): SynthesizeResult {
  const exploreDir = resolveExploreDir(target);
  const bundle = loadExploreBundle(exploreDir);

  const targetDir = opts.outDir ?? path.join(exploreDir, 'candidates');
  fs.mkdirSync(targetDir, { recursive: true });

  const site = bundle.manifest.site;
  const capabilities = (bundle.capabilities ?? [])
    .slice(0, opts.top ?? 3);
  const candidates: SynthesizeCandidateSummary[] = [];

  for (const cap of capabilities) {
    const endpoint = chooseEndpoint(cap, bundle.endpoints);
    if (!endpoint) continue;
    const candidate = buildCandidateYaml(site, bundle.manifest, cap, endpoint);
    const filePath = path.join(targetDir, `${candidate.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(candidate.yaml, null, 2));
    candidates.push({ name: candidate.name, path: filePath, strategy: cap.strategy });
  }

  const index = { site, target_url: bundle.manifest.target_url, generated_from: exploreDir, candidate_count: candidates.length, candidates };
  fs.writeFileSync(path.join(targetDir, 'candidates.json'), JSON.stringify(index, null, 2));

  return { site, explore_dir: exploreDir, out_dir: targetDir, candidate_count: candidates.length, candidates };
}

export function renderSynthesizeSummary(result: SynthesizeResult): string {
  const lines = ['opencli synthesize: OK', `Site: ${result.site}`, `Source: ${result.explore_dir}`, `Candidates: ${result.candidate_count}`];
  for (const c of result.candidates ?? []) lines.push(`  • ${c.name} (${c.strategy}) → ${c.path}`);
  return lines.join('\n');
}

export function resolveExploreDir(target: string): string {
  if (fs.existsSync(target)) return target;
  const candidate = path.join('.opencli', 'explore', target);
  if (fs.existsSync(candidate)) return candidate;
  throw new Error(`Explore directory not found: ${target}`);
}

export function loadExploreBundle(exploreDir: string): LoadedExploreBundle {
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(exploreDir, 'manifest.json'), 'utf-8')) as ExploreManifest,
    endpoints: JSON.parse(fs.readFileSync(path.join(exploreDir, 'endpoints.json'), 'utf-8')) as ExploreEndpointArtifact[],
    capabilities: JSON.parse(fs.readFileSync(path.join(exploreDir, 'capabilities.json'), 'utf-8')) as SynthesizeCapability[],
    auth: JSON.parse(fs.readFileSync(path.join(exploreDir, 'auth.json'), 'utf-8')),
  };
}

function chooseEndpoint(cap: SynthesizeCapability, endpoints: ExploreEndpointArtifact[]): ExploreEndpointArtifact | null {
  if (!endpoints.length) return null;
  // Match by endpoint pattern from capability
  if (cap.endpoint) {
    const endpointPattern = cap.endpoint;
    const match = endpoints.find((endpoint) => endpoint.pattern === endpointPattern || endpoint.url?.includes(endpointPattern));
    if (match) return match;
  }
  // Fallback: prefer endpoint with most data (item count + detected fields)
  return [...endpoints].sort((a, b) => {
    const aKey = (a.itemCount ?? 0) * 10 + Object.keys(a.detectedFields ?? {}).length;
    const bKey = (b.itemCount ?? 0) * 10 + Object.keys(b.detectedFields ?? {}).length;
    return bKey - aKey;
  })[0];
}

// ── URL templating ─────────────────────────────────────────────────────────

function buildTemplatedUrl(rawUrl: string, cap: SynthesizeCapability, _endpoint: ExploreEndpointArtifact): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.protocol}//${u.host}${u.pathname}`;
    const params: Array<[string, string]> = [];
    const hasKeyword = cap.recommendedArgs?.some((arg) => arg.name === 'keyword');

    u.searchParams.forEach((v, k) => {
      if (VOLATILE_PARAMS.has(k)) return;
      if (hasKeyword && SEARCH_PARAMS.has(k)) params.push([k, '${{ args.keyword }}']);
      else if (LIMIT_PARAMS.has(k)) params.push([k, '${{ args.limit | default(20) }}']);
      else if (PAGINATION_PARAMS.has(k)) params.push([k, '${{ args.page | default(1) }}']);
      else params.push([k, v]);
    });

    return params.length ? base + '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : base;
  } catch { return rawUrl; }
}

/**
 * Build inline evaluate script for browser-based fetch+parse.
 * Follows patterns from bilibili/hot.ts and twitter/trending.ts.
 */
function buildEvaluateScript(url: string, itemPath: string, endpoint: ExploreEndpointArtifact): string {
  const pathChain = itemPath.split('.').map((p: string) => `?.${p}`).join('');
  const detectedFields = endpoint?.detectedFields ?? {};
  const hasFields = Object.keys(detectedFields).length > 0;

  let mapCode = '';
  if (hasFields) {
    const mappings = Object.entries(detectedFields)
      .map(([role, field]) => `      ${role}: item${String(field).split('.').map(p => `?.${p}`).join('')}`)
      .join(',\n');
    mapCode = `.map((item) => ({\n${mappings}\n    }))`;
  }

  return [
    '(async () => {',
    `  const res = await fetch(${JSON.stringify(url)}, {`,
    `    credentials: 'include'`,
    '  });',
    '  const data = await res.json();',
    `  return (data${pathChain} || [])${mapCode};`,
    '})()\n',
  ].join('\n');
}

// ── Pipeline generation ────────────────────────────────────────────────────

function buildCandidateYaml(site: string, manifest: ExploreManifestLike, cap: SynthesizeCapability, endpoint: ExploreEndpointArtifact): { name: string; yaml: CandidateYaml } {
  const needsBrowser = cap.strategy !== 'public';
  const pipeline: CandidatePipelineStep[] = [];
  const templatedUrl = buildTemplatedUrl(endpoint?.url ?? manifest.target_url, cap, endpoint);

  let domain = '';
  try { domain = new URL(manifest.target_url).hostname; } catch {}

  if (cap.strategy === 'store-action' && cap.storeHint) {
    // Store Action: navigate + wait + tap (declarative, clean)
    pipeline.push({ navigate: manifest.target_url });
    pipeline.push({ wait: 3 });
    const tapStep: { store: string; action: string; timeout: number; capture?: string; select?: string | null } = {
      store: cap.storeHint.store,
      action: cap.storeHint.action,
      timeout: 8,
    };
    // Infer capture pattern from endpoint URL
    if (endpoint?.url) {
      try {
        const epUrl = new URL(endpoint.url);
        const pathParts = epUrl.pathname.split('/').filter((p: string) => p);
        // Use last meaningful path segment as capture pattern
        const capturePart = pathParts.filter((p: string) => !p.match(/^v\d+$/)).pop();
        if (capturePart) tapStep.capture = capturePart;
      } catch {}
    }
    if (cap.itemPath) tapStep.select = cap.itemPath;
    pipeline.push({ tap: tapStep });
  } else if (needsBrowser) {
    // Browser-based: navigate + evaluate (like bilibili/hot, twitter/trending)
    pipeline.push({ navigate: manifest.target_url });
    const itemPath = cap.itemPath ?? 'data.data.list';
    pipeline.push({ evaluate: buildEvaluateScript(templatedUrl, itemPath, endpoint) });
  } else {
    // Public API: direct fetch (like hackernews/top)
    pipeline.push({ fetch: { url: templatedUrl } });
    if (cap.itemPath) pipeline.push({ select: cap.itemPath });
  }

  // Map fields
  const mapStep: Record<string, string> = {};
  const columns = cap.recommendedColumns ?? ['title', 'url'];
  if (!cap.recommendedArgs?.some((arg) => arg.name === 'keyword')) mapStep['rank'] = '${{ index + 1 }}';
  const detectedFields = endpoint?.detectedFields ?? {};
  for (const col of columns) {
    const fieldPath = detectedFields[col];
    mapStep[col] = fieldPath ? `\${{ item.${fieldPath} }}` : `\${{ item.${col} }}`;
  }
  pipeline.push({ map: mapStep });
  pipeline.push({ limit: '${{ args.limit | default(20) }}' });

  // Args
  const argsDef: Record<string, GeneratedArgDefinition> = {};
  for (const arg of cap.recommendedArgs ?? []) {
    const def: GeneratedArgDefinition = { type: arg.type ?? 'str' };
    if (arg.required) def.required = true;
    if (arg.default != null) def.default = arg.default;
    if (arg.name === 'keyword') def.description = 'Search keyword';
    else if (arg.name === 'limit') def.description = 'Number of items to return';
    else if (arg.name === 'page') def.description = 'Page number';
    argsDef[arg.name] = def;
  }
  if (!argsDef['limit']) argsDef['limit'] = { type: 'int', default: 20, description: 'Number of items to return' };

  return {
    name: cap.name,
    yaml: {
      site, name: cap.name, description: `${cap.description || site + ' ' + cap.name} (auto-generated)`,
      domain, strategy: cap.strategy, browser: needsBrowser,
      args: argsDef, pipeline, columns: Object.keys(mapStep),
    },
  };
}

export function buildCandidate(site: string, targetUrl: string, cap: SynthesizeCapability, endpoint: ExploreEndpointArtifact): { name: string; yaml: CandidateYaml } {
  const manifest = { target_url: targetUrl, final_url: targetUrl };
  return buildCandidateYaml(site, manifest, cap, endpoint);
}
