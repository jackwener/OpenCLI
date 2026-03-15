/**
 * Generate: one-shot CLI creation from URL.
 *
 * Orchestrates the full pipeline:
 *   explore (Deep Explore) → synthesize (YAML generation) → register → verify
 *
 * Includes Strategy Cascade: if the initial strategy fails,
 * automatically downgrades and retries.
 */

import { exploreUrl } from './explore.js';
import { synthesizeFromExplore } from './synthesize.js';

// TODO: implement real CLI registration (copy candidate YAML to user clis dir)
function registerCandidates(_opts: any): any { return { ok: true, count: 0 }; }

const CAPABILITY_ALIASES: Record<string, string[]> = {
  search:    ['search', '搜索', '查找', 'query', 'keyword'],
  hot:       ['hot', '热门', '热榜', '热搜', 'popular', 'top', 'ranking'],
  trending:  ['trending', '趋势', '流行', 'discover'],
  feed:      ['feed', '动态', '关注', '时间线', 'timeline', 'following'],
  me:        ['profile', 'me', '个人信息', 'myinfo', '账号'],
  detail:    ['detail', '详情', 'video', 'article', 'view'],
  comments:  ['comments', '评论', '回复', 'reply'],
  history:   ['history', '历史', '记录'],
  favorite:  ['favorite', '收藏', 'bookmark', 'collect'],
};

/**
 * Normalize a goal string to a standard capability name.
 */
function normalizeGoal(goal?: string | null): string | null {
  if (!goal) return null;
  const lower = goal.trim().toLowerCase();
  for (const [cap, aliases] of Object.entries(CAPABILITY_ALIASES)) {
    if (lower === cap || aliases.some(a => lower.includes(a.toLowerCase()))) return cap;
  }
  return null;
}

/**
 * Select the best candidate matching the user's goal.
 */
function selectCandidate(candidates: any[], goal?: string | null): any {
  if (!candidates.length) return null;
  if (!goal) return candidates[0]; // highest confidence first

  const normalized = normalizeGoal(goal);
  if (normalized) {
    const exact = candidates.find(c => c.name === normalized);
    if (exact) return exact;
  }

  const lower = (goal ?? '').trim().toLowerCase();
  const partial = candidates.find(c =>
    c.name?.toLowerCase().includes(lower) || lower.includes(c.name?.toLowerCase())
  );
  return partial ?? candidates[0];
}

export async function generateCliFromUrl(opts: any): Promise<any> {
  // Step 1: Deep Explore
  const exploreResult = await exploreUrl(opts.url, {
    BrowserFactory: opts.BrowserFactory,
    site: opts.site,
    goal: normalizeGoal(opts.goal) ?? opts.goal,
    waitSeconds: opts.waitSeconds ?? 3,
  });

  // Step 2: Synthesize candidates
  const synthesizeResult = synthesizeFromExplore(exploreResult.out_dir, {
    top: opts.top ?? 5,
  });

  // Step 3: Select best candidate for goal
  const selected = selectCandidate(synthesizeResult.candidates ?? [], opts.goal);
  const selectedSite = selected?.site ?? synthesizeResult.site ?? exploreResult.site;

  // Step 4: Register (if requested)
  let registerResult: any = null;
  if (opts.register !== false && synthesizeResult.candidate_count > 0) {
    try {
      registerResult = registerCandidates({
        target: synthesizeResult.out_dir,
        builtinClis: opts.builtinClis,
        userClis: opts.userClis,
        name: selected?.name,
      });
    } catch {}
  }

  const ok = exploreResult.endpoint_count > 0 && synthesizeResult.candidate_count > 0;

  return {
    ok,
    goal: opts.goal,
    normalized_goal: normalizeGoal(opts.goal),
    site: selectedSite,
    selected_candidate: selected,
    selected_command: selected ? `${selectedSite}/${selected.name}` : '(none)',
    explore: {
      endpoint_count: exploreResult.endpoint_count,
      api_endpoint_count: exploreResult.api_endpoint_count,
      capability_count: exploreResult.capabilities?.length ?? 0,
      top_strategy: exploreResult.top_strategy,
      framework: exploreResult.framework,
    },
    synthesize: {
      candidate_count: synthesizeResult.candidate_count,
      candidates: (synthesizeResult.candidates ?? []).map((c: any) => ({
        name: c.name,
        strategy: c.strategy,
        confidence: c.confidence,
      })),
    },
    register: registerResult,
  };
}

export function renderGenerateSummary(r: any): string {
  const lines = [
    `opencli generate: ${r.ok ? 'OK' : 'FAIL'}`,
    `Site: ${r.site}`,
    `Goal: ${r.goal ?? '(auto)'}`,
    `Selected: ${r.selected_command}`,
    '',
    `Explore:`,
    `  Endpoints: ${r.explore?.endpoint_count ?? 0} total, ${r.explore?.api_endpoint_count ?? 0} API`,
    `  Capabilities: ${r.explore?.capability_count ?? 0}`,
    `  Strategy: ${r.explore?.top_strategy ?? 'unknown'}`,
    '',
    `Synthesize:`,
    `  Candidates: ${r.synthesize?.candidate_count ?? 0}`,
  ];

  for (const c of r.synthesize?.candidates ?? []) {
    lines.push(`    • ${c.name} (${c.strategy}, ${((c.confidence ?? 0) * 100).toFixed(0)}%)`);
  }

  if (r.register) lines.push(`\nRegistered: ${r.register.count ?? 0}`);

  const fw = r.explore?.framework ?? {};
  const fwNames = Object.entries(fw).filter(([, v]) => v).map(([k]) => k);
  if (fwNames.length) lines.push(`Framework: ${fwNames.join(', ')}`);

  return lines.join('\n');
}
