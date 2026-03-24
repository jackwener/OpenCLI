/**
 * Record session orchestration — browser interaction, polling, and analysis output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { sendCommand } from '../browser/daemon-client.js';

import type { RecordedRequest, RecordResult, RecordOptions } from './types.js';
import { generateFullCaptureInterceptorJs, generateReadRecordedJs } from './interceptor.js';
import { urlToPattern, detectAuthIndicators, findArrayPath, inferCapabilityName, inferStrategy, scoreRequest } from './analysis.js';
import { buildRecordedYaml } from './generator.js';

// ── Tab helpers ────────────────────────────────────────────────────────────

interface TabInfo { tabId: number; url?: string }

async function listTabs(workspace: string): Promise<TabInfo[]> {
  try {
    const result = await sendCommand('tabs', { op: 'list', workspace }) as TabInfo[] | null;
    return Array.isArray(result) ? result.filter(t => t.tabId != null) : [];
  } catch { return []; }
}

async function execOnTab(workspace: string, tabId: number, code: string): Promise<unknown> {
  return sendCommand('exec', { code, workspace, tabId });
}

async function injectIntoTab(workspace: string, tabId: number, injectedTabs: Set<number>): Promise<void> {
  try {
    await execOnTab(workspace, tabId, generateFullCaptureInterceptorJs());
    if (!injectedTabs.has(tabId)) {
      injectedTabs.add(tabId);
      console.log(chalk.green(`  ✓  Interceptor injected into tab:${tabId}`));
    }
  } catch {
    // Tab not debuggable (e.g. chrome:// pages) — skip silently
  }
}

/**
 * Wait for user to press Enter on stdin.
 * Returns both a promise and a cleanup fn so the caller can close the interface
 * when a timeout fires (preventing the process from hanging on stdin).
 */
function waitForEnter(): { promise: Promise<void>; cleanup: () => void } {
  let rl: readline.Interface | null = null;
  const promise = new Promise<void>((resolve) => {
    rl = readline.createInterface({ input: process.stdin });
    rl.once('line', () => { rl?.close(); rl = null; resolve(); });
    // Handle Ctrl+C gracefully
    rl.once('SIGINT', () => { rl?.close(); rl = null; resolve(); });
  });
  return {
    promise,
    cleanup: () => { rl?.close(); rl = null; },
  };
}

// ── Main record function ───────────────────────────────────────────────────

export async function recordSession(opts: RecordOptions): Promise<RecordResult> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const allRequests: RecordedRequest[] = [];
  // Track which tabIds have already had the interceptor injected
  const injectedTabs = new Set<number>();

  // Infer site name from URL
  const site = opts.site ?? (() => {
    try {
      const host = new URL(opts.url).hostname.toLowerCase().replace(/^www\./, '');
      return host.split('.')[0] ?? 'site';
    } catch { return 'site'; }
  })();

  const workspace = `record:${site}`;

  console.log(chalk.bold.cyan('\n  opencli record'));
  console.log(chalk.dim(`  Site: ${site}  URL: ${opts.url}`));
  console.log(chalk.dim(`  Timeout: ${timeoutMs / 1000}s  Poll: ${pollMs}ms`));
  console.log(chalk.dim('  Navigating…'));

  const factory = new opts.BrowserFactory();
  const page = await factory.connect({ timeout: 30, workspace });

  try {
    // Navigate to target
    await page.goto(opts.url);

    // Inject into initial tab
    const initialTabs = await listTabs(workspace);
    for (const tab of initialTabs) {
      await injectIntoTab(workspace, tab.tabId, injectedTabs);
    }

    console.log(chalk.bold('\n  Recording. Operate the page in the automation window.'));
    console.log(chalk.dim(`  Will auto-stop after ${timeoutMs / 1000}s, or press Enter to stop now.\n`));

    // Race: Enter key vs timeout
    let stopped = false;
    const stop = () => { stopped = true; };

    const { promise: enterPromise, cleanup: cleanupEnter } = waitForEnter();
    enterPromise.then(stop);
    const timeoutPromise = new Promise<void>(r => setTimeout(() => {
      stop();
      r();
    }, timeoutMs));

    // Poll loop: drain captured data + inject interceptor into any new tabs
    const pollInterval = setInterval(async () => {
      if (stopped) return;
      try {
        // Discover and inject into any new tabs
        const tabs = await listTabs(workspace);
        for (const tab of tabs) {
          await injectIntoTab(workspace, tab.tabId, injectedTabs);
        }

        // Drain captured data from all known tabs
        for (const tabId of injectedTabs) {
          const batch = await execOnTab(workspace, tabId, generateReadRecordedJs()) as RecordedRequest[] | null;
          if (Array.isArray(batch) && batch.length > 0) {
            for (const r of batch) allRequests.push(r);
            console.log(chalk.dim(`  [tab:${tabId}] +${batch.length} captured — total: ${allRequests.length}`));
          }
        }
      } catch {
        // Tab may have navigated; keep going
      }
    }, pollMs);

    await Promise.race([enterPromise, timeoutPromise]);
    cleanupEnter(); // Always clean up readline to prevent process from hanging
    clearInterval(pollInterval);

    // Final drain from all known tabs
    for (const tabId of injectedTabs) {
      try {
        const last = await execOnTab(workspace, tabId, generateReadRecordedJs()) as RecordedRequest[] | null;
        if (Array.isArray(last) && last.length > 0) {
          for (const r of last) allRequests.push(r);
        }
      } catch {}
    }

    console.log(chalk.dim(`\n  Stopped. Analyzing ${allRequests.length} captured requests…`));

    const result = analyzeAndWrite(site, opts.url, allRequests, opts.outDir);
    await factory.close().catch(() => {});
    return result;
  } catch (err) {
    await factory.close().catch(() => {});
    throw err;
  }
}

// ── Analysis + output ──────────────────────────────────────────────────────

type ScoredEntry = {
  req: RecordedRequest;
  pattern: string;
  arrayResult: ReturnType<typeof findArrayPath>;
  authIndicators: string[];
  score: number;
};

function analyzeAndWrite(
  site: string,
  pageUrl: string,
  requests: RecordedRequest[],
  outDir?: string,
): RecordResult {
  const targetDir = outDir ?? path.join('.opencli', 'record', site);
  fs.mkdirSync(targetDir, { recursive: true });

  if (requests.length === 0) {
    console.log(chalk.yellow('  No API requests captured.'));
    return { site, url: pageUrl, requests: [], outDir: targetDir, candidateCount: 0, candidates: [] };
  }

  // Deduplicate by pattern
  const seen = new Map<string, RecordedRequest>();
  for (const req of requests) {
    const pattern = urlToPattern(req.url);
    if (!seen.has(pattern)) seen.set(pattern, req);
  }

  // Score and rank unique requests
  const scored: ScoredEntry[] = [];
  for (const [pattern, req] of seen) {
    const arrayResult = findArrayPath(req.body);
    const authIndicators = detectAuthIndicators(req.url, req.body);
    const score = scoreRequest(req, arrayResult);
    if (score > 0) {
      scored.push({ req, pattern, arrayResult, authIndicators, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // Save raw captured data
  fs.writeFileSync(
    path.join(targetDir, 'captured.json'),
    JSON.stringify({ site, url: pageUrl, capturedAt: new Date().toISOString(), requests }, null, 2),
  );

  // Generate candidate YAMLs (top 5)
  const candidates: RecordResult['candidates'] = [];
  const usedNames = new Set<string>();

  console.log(chalk.bold('\n  Captured endpoints (scored):\n'));

  for (const entry of scored.slice(0, 8)) {
    const itemCount = entry.arrayResult?.items.length ?? 0;
    const strategy = inferStrategy(entry.authIndicators);
    const marker = entry.score >= 15 ? chalk.green('★') : entry.score >= 8 ? chalk.yellow('◆') : chalk.dim('·');
    console.log(
      `  ${marker} ${chalk.white(entry.pattern)}` +
      chalk.dim(` [${strategy}]`) +
      (itemCount ? chalk.cyan(` ← ${itemCount} items`) : ''),
    );
  }

  console.log();

  const topCandidates = scored.filter(e => e.arrayResult && e.score >= 8).slice(0, 5);
  const candidatesDir = path.join(targetDir, 'candidates');
  fs.mkdirSync(candidatesDir, { recursive: true });

  for (const entry of topCandidates) {
    let capName = inferCapabilityName(entry.req.url);
    if (usedNames.has(capName)) capName = `${capName}_${usedNames.size + 1}`;
    usedNames.add(capName);

    const strategy = inferStrategy(entry.authIndicators);
    const candidate = buildRecordedYaml(site, pageUrl, entry.req, capName, entry.arrayResult!, entry.authIndicators);
    const filePath = path.join(candidatesDir, `${capName}.yaml`);
    fs.writeFileSync(filePath, yaml.dump(candidate.yaml, { sortKeys: false, lineWidth: 120 }));
    candidates.push({ name: capName, path: filePath, strategy });

    console.log(chalk.green(`  ✓ Generated: ${chalk.bold(capName)}.yaml  [${strategy}]`));
    console.log(chalk.dim(`    → ${filePath}`));
  }

  if (candidates.length === 0) {
    console.log(chalk.yellow('  No high-confidence candidates found.'));
    console.log(chalk.dim('  Tip: make sure you triggered JSON API calls (open lists, search, scroll).'));
  }

  return {
    site,
    url: pageUrl,
    requests,
    outDir: targetDir,
    candidateCount: candidates.length,
    candidates,
  };
}

export function renderRecordSummary(result: RecordResult): string {
  const lines = [
    `\n  opencli record: ${result.candidateCount > 0 ? chalk.green('OK') : chalk.yellow('no candidates')}`,
    `  Site: ${result.site}`,
    `  Captured: ${result.requests.length} requests`,
    `  Candidates: ${result.candidateCount}`,
  ];
  for (const c of result.candidates) {
    lines.push(`    • ${c.name} [${c.strategy}] → ${c.path}`);
  }
  if (result.candidateCount > 0) {
    lines.push('');
    lines.push(chalk.dim(`  Copy a candidate to src/clis/${result.site}/ and run: npm run build`));
  }
  return lines.join('\n');
}
