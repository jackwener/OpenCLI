#!/usr/bin/env npx tsx
/**
 * V2EX Test Suite: Deterministic command testing against v2ex.com.
 *
 * 40 tasks across 5 difficulty layers:
 *   L1 Atomic (10) → L2 Single Page (10) → L3 Multi-Step (10)
 *   → L4 Write Ops (5) → L5 Complex Chain (5)
 *
 * Usage:
 *   npx tsx autoresearch/eval-v2ex.ts                    # Run all tasks
 *   npx tsx autoresearch/eval-v2ex.ts --task v2ex-hot-topics  # Run single task
 *   npx tsx autoresearch/eval-v2ex.ts --layer 1          # Run only Layer 1 (atomic)
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = join(__dirname, 'v2ex-tasks.json');
const RESULTS_DIR = join(__dirname, 'results');

interface BrowseTask {
  name: string;
  steps: string[];
  judge: JudgeCriteria;
  set?: 'test';
  note?: string;
  _comment?: string;
}

type JudgeCriteria =
  | { type: 'contains'; value: string }
  | { type: 'arrayMinLength'; minLength: number }
  | { type: 'nonEmpty' }
  | { type: 'matchesPattern'; pattern: string };

interface TaskResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  layer: string;
}

// Layer classification by task name prefix pattern
function getLayer(name: string): string {
  if (['v2ex-open-', 'v2ex-state-', 'v2ex-get-title', 'v2ex-click-tab', 'v2ex-scroll-down',
       'v2ex-get-first-', 'v2ex-eval-extract', 'v2ex-get-url', 'v2ex-back-nav', 'v2ex-wait-'].some(p => name.startsWith(p)))
    return 'L1-atomic';
  if (['v2ex-hot-topics', 'v2ex-node-list', 'v2ex-topic-meta', 'v2ex-node-topics',
       'v2ex-node-pagination', 'v2ex-tab-content', 'v2ex-topic-replies-extract',
       'v2ex-topic-reply-count', 'v2ex-member-info', 'v2ex-search-results'].includes(name))
    return 'L2-single-page';
  if (['v2ex-click-topic-read', 'v2ex-click-author', 'v2ex-navigate-node', 'v2ex-pagination-page2',
       'v2ex-topic-and-back', 'v2ex-tab-then-topic', 'v2ex-scroll-find-more',
       'v2ex-node-to-topic', 'v2ex-multi-tab-compare', 'v2ex-topic-reply-to-author'].some(p => name.startsWith(p)))
    return 'L3-multi-step';
  if (['v2ex-reply-', 'v2ex-favorite-', 'v2ex-thank-', 'v2ex-create-'].some(p => name.startsWith(p)))
    return 'L4-write';
  if (['v2ex-collect-', 'v2ex-multi-node-', 'v2ex-topic-deep-', 'v2ex-cross-page-', 'v2ex-full-'].some(p => name.startsWith(p)))
    return 'L5-complex';
  return 'unknown';
}

function judge(criteria: JudgeCriteria, output: string): boolean {
  try {
    switch (criteria.type) {
      case 'contains':
        return output.toLowerCase().includes(criteria.value.toLowerCase());
      case 'arrayMinLength': {
        try {
          const arr = JSON.parse(output);
          if (Array.isArray(arr)) return arr.length >= criteria.minLength;
        } catch { /* not JSON array */ }
        return false;
      }
      case 'nonEmpty':
        return output.trim().length > 0 && output.trim() !== 'null' && output.trim() !== 'undefined';
      case 'matchesPattern':
        return new RegExp(criteria.pattern).test(output);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function runCommand(cmd: string, timeout = 30000): string {
  try {
    return execSync(cmd, {
      cwd: join(__dirname, '..'),
      timeout,
      encoding: 'utf-8',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() ?? '';
  }
}

function runTask(task: BrowseTask): TaskResult {
  const start = Date.now();
  let lastOutput = '';

  try {
    for (const step of task.steps) {
      lastOutput = runCommand(step);
    }

    const passed = judge(task.judge, lastOutput);

    return {
      name: task.name,
      passed,
      duration: Date.now() - start,
      error: passed ? undefined : `Output: ${lastOutput.slice(0, 150)}`,
      layer: getLayer(task.name),
    };
  } catch (err: any) {
    return {
      name: task.name,
      passed: false,
      duration: Date.now() - start,
      error: err.message?.slice(0, 100),
      layer: getLayer(task.name),
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;
  const layerFilter = args.includes('--layer') ? args[args.indexOf('--layer') + 1] : null;

  const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf-8')) as (BrowseTask | { _comment: string })[];
  const allTasks = raw.filter((t): t is BrowseTask => 'name' in t && 'steps' in t);

  let tasks = allTasks;
  if (singleTask) {
    tasks = allTasks.filter(t => t.name === singleTask);
  } else if (layerFilter) {
    const prefix = `L${layerFilter}`;
    tasks = allTasks.filter(t => getLayer(t.name).startsWith(prefix));
  }

  if (tasks.length === 0) {
    console.error(singleTask ? `Task "${singleTask}" not found.` : `No tasks for layer ${layerFilter}.`);
    process.exit(1);
  }

  console.log(`\n🔬 V2EX Test Suite — ${tasks.length} tasks\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] ${task.name}...`);

    const result = runTask(task);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    console.log(` ${icon} (${(result.duration / 1000).toFixed(1)}s)`);

    // Close browser between tasks for clean state
    if (i < tasks.length - 1) {
      try { runCommand('opencli operate close'); } catch { /* ignore */ }
    }
  }

  // Final close
  try { runCommand('opencli operate close'); } catch { /* ignore */ }

  // Summary by layer
  const layers = [...new Set(results.map(r => r.layer))].sort();
  const totalPassed = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Total:  ${totalPassed}/${results.length}`);
  for (const layer of layers) {
    const layerResults = results.filter(r => r.layer === layer);
    const layerPassed = layerResults.filter(r => r.passed).length;
    console.log(`  ${layer}: ${layerPassed}/${layerResults.length}`);
  }
  console.log(`  Time:   ${Math.round(totalDuration / 60000)}min`);

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ [${f.layer}] ${f.name}: ${f.error ?? 'unknown'}`);
    }
  }
  console.log('');

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('v2ex-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `v2ex-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    layers: Object.fromEntries(layers.map(l => {
      const lr = results.filter(r => r.layer === l);
      return [l, `${lr.filter(r => r.passed).length}/${lr.length}`];
    })),
    duration: `${Math.round(totalDuration / 60000)}min`,
    tasks: results,
  }, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
