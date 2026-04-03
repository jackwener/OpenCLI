#!/usr/bin/env npx tsx
/**
 * Combined Test Suite Runner — runs browse + V2EX + Zhihu tasks.
 * Reports combined score for AutoResearch iteration.
 *
 * Usage:
 *   npx tsx autoresearch/eval-all.ts              # Run all
 *   npx tsx autoresearch/eval-all.ts --suite v2ex  # Run one suite
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RESULTS_DIR = join(__dirname, 'results');

interface SuiteResult {
  name: string;
  passed: number;
  total: number;
  failures: string[];
  duration: number;
}

function runSuite(name: string, script: string): SuiteResult {
  const start = Date.now();
  try {
    const output = execSync(`npx tsx ${script}`, {
      cwd: ROOT,
      timeout: 600_000,
      encoding: 'utf-8',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse SCORE=X/Y from output
    const scoreMatch = output.match(/SCORE=(\d+)\/(\d+)/);
    const passed = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const total = scoreMatch ? parseInt(scoreMatch[2], 10) : 0;

    // Parse failures
    const failures: string[] = [];
    const failLines = output.match(/✗.*$/gm) || [];
    for (const line of failLines) {
      const m = line.match(/✗\s+(?:\[.*?\]\s+)?(\S+)/);
      if (m) failures.push(m[1].replace(/:$/, ''));
    }

    return { name, passed, total, failures, duration: Date.now() - start };
  } catch (err: any) {
    const output = err.stdout ?? '';
    const scoreMatch = output.match(/SCORE=(\d+)\/(\d+)/);
    const passed = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;
    const total = scoreMatch ? parseInt(scoreMatch[2], 10) : 0;
    const failures: string[] = [];
    const failLines = output.match(/✗.*$/gm) || [];
    for (const line of failLines) {
      const m = line.match(/✗\s+(?:\[.*?\]\s+)?(\S+)/);
      if (m) failures.push(m[1].replace(/:$/, ''));
    }
    return { name, passed, total, failures, duration: Date.now() - start };
  }
}

function main() {
  const args = process.argv.slice(2);
  const singleSuite = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null;

  const suites = [
    { name: 'browse', script: 'autoresearch/eval-browse.ts' },
    { name: 'v2ex', script: 'autoresearch/eval-v2ex.ts' },
    { name: 'zhihu', script: 'autoresearch/eval-zhihu.ts' },
  ].filter(s => !singleSuite || s.name === singleSuite);

  console.log(`\n🔬 Combined AutoResearch — ${suites.length} suites\n`);

  const results: SuiteResult[] = [];
  for (const suite of suites) {
    console.log(`  Running ${suite.name}...`);
    const result = runSuite(suite.name, suite.script);
    results.push(result);
    const icon = result.passed === result.total ? '✓' : '✗';
    console.log(`    ${icon} ${result.name}: ${result.passed}/${result.total} (${Math.round(result.duration / 1000)}s)`);
    if (result.failures.length > 0) {
      for (const f of result.failures.slice(0, 5)) {
        console.log(`      ✗ ${f}`);
      }
    }
  }

  // Summary
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalTasks = results.reduce((s, r) => s + r.total, 0);
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);
  const allFailures = results.flatMap(r => r.failures.map(f => `${r.name}:${f}`));

  console.log(`\n${'━'.repeat(50)}`);
  console.log(`  Combined: ${totalPassed}/${totalTasks}`);
  for (const r of results) {
    console.log(`    ${r.name}: ${r.passed}/${r.total}`);
  }
  console.log(`  Time: ${Math.round(totalDuration / 60000)}min`);
  if (allFailures.length > 0) {
    console.log(`\n  All failures:`);
    for (const f of allFailures) console.log(`    ✗ ${f}`);
  }

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('all-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `all-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${totalTasks}`,
    suites: Object.fromEntries(results.map(r => [r.name, `${r.passed}/${r.total}`])),
    failures: allFailures,
    duration: `${Math.round(totalDuration / 60000)}min`,
  }, null, 2), 'utf-8');
  console.log(`\n  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${totalTasks}`);
}

main();
