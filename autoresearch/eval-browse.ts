#!/usr/bin/env npx tsx
/**
 * Layer 1: Deterministic Browse Command Testing
 *
 * Runs predefined opencli operate command sequences against real websites.
 * No LLM involved — tests command reliability only.
 *
 * Usage:
 *   npx tsx autoresearch/eval-browse.ts              # Run all tasks
 *   npx tsx autoresearch/eval-browse.ts --task hn-top5  # Run single task
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = join(__dirname, 'browse-tasks.json');
const RESULTS_DIR = join(__dirname, 'results');
const BASELINE_FILE = join(__dirname, 'baseline-browse.txt');

interface BrowseTask {
  name: string;
  steps: string[];
  judge: JudgeCriteria;
  set?: 'test';
  note?: string;
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
  set: 'train' | 'test';
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

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: join(__dirname, '..'),
      timeout: 30000,
      encoding: 'utf-8',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() || err.stderr?.trim() || '';
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
      error: passed ? undefined : `Output: ${lastOutput.slice(0, 100)}`,
      set: task.set === 'test' ? 'test' : 'train',
    };
  } catch (err: any) {
    return {
      name: task.name,
      passed: false,
      duration: Date.now() - start,
      error: err.message?.slice(0, 100),
      set: task.set === 'test' ? 'test' : 'train',
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;

  const allTasks: BrowseTask[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
  const tasks = singleTask ? allTasks.filter(t => t.name === singleTask) : allTasks;

  if (tasks.length === 0) {
    console.error(`Task "${singleTask}" not found.`);
    process.exit(1);
  }

  console.log(`\n🔬 Layer 1: Browse Commands — ${tasks.length} tasks\n`);

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

  // Summary
  const trainResults = results.filter(r => r.set === 'train');
  const testResults = results.filter(r => r.set === 'test');
  const totalPassed = results.filter(r => r.passed).length;
  const trainPassed = trainResults.filter(r => r.passed).length;
  const testPassed = testResults.filter(r => r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:  ${totalPassed}/${results.length} (train: ${trainPassed}/${trainResults.length}, test: ${testPassed}/${testResults.length})`);
  console.log(`  Time:   ${Math.round(totalDuration / 60000)}min`);

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.error ?? 'unknown'}`);
    }
  }
  console.log('');

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('browse-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `browse-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    trainScore: `${trainPassed}/${trainResults.length}`,
    testScore: `${testPassed}/${testResults.length}`,
    duration: `${Math.round(totalDuration / 60000)}min`,
    tasks: results,
  }, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
