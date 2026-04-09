#!/usr/bin/env npx tsx
/**
 * Layer 5: Publish Testing — end-to-end content creation via browser commands
 *
 * Tests the full chain: read content → navigate to platform → fill title+body → (optionally) publish → verify → cleanup
 *
 * Task types:
 *   fill-only: navigate + fill fields + verify content was entered (safe, no side effects)
 *   publish:   full publish + verify + cleanup (deletes the post after verification)
 *
 * Usage:
 *   npx tsx autoresearch/eval-publish.ts                        # Run all tasks
 *   npx tsx autoresearch/eval-publish.ts --task twitter-fill     # Run single task
 *   npx tsx autoresearch/eval-publish.ts --type fill-only        # Run only fill tasks (safe)
 *   npx tsx autoresearch/eval-publish.ts --type publish          # Run only publish tasks (destructive)
 *   npx tsx autoresearch/eval-publish.ts --platform twitter      # Run only twitter tasks
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const TASKS_FILE = join(__dirname, 'publish-tasks.json');
const RESULTS_DIR = join(__dirname, 'results');

interface PublishTask {
  name: string;
  platform: string;
  type: 'fill-only' | 'publish';
  description: string;
  steps: string[];
  judge: JudgeCriteria;
  cleanup?: string[];
  note?: string;
}

type JudgeCriteria =
  | { type: 'contains'; value: string }
  | { type: 'arrayMinLength'; minLength: number }
  | { type: 'nonEmpty' }
  | { type: 'matchesPattern'; pattern: string };

interface TaskResult {
  name: string;
  platform: string;
  taskType: 'fill-only' | 'publish';
  passed: boolean;
  duration: number;
  cleanupResult?: string;
  error?: string;
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
        } catch { /* not JSON */ }
        return false;
      }
      case 'nonEmpty':
        return output.trim().length > 0 && output.trim() !== 'null' && output.trim() !== 'undefined';
      case 'matchesPattern':
        return new RegExp(criteria.pattern, 'i').test(output);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function runCommand(cmd: string, timeout = 30000): string {
  const localCmd = cmd.replace(/^opencli /, `node dist/src/main.js `);
  try {
    return execSync(localCmd, {
      cwd: PROJECT_ROOT,
      timeout,
      encoding: 'utf-8',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() || err.stderr?.trim() || '';
  }
}

function runTask(task: PublishTask): TaskResult {
  const start = Date.now();

  try {
    // Run main steps
    let lastOutput = '';
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];
      process.stderr.write(`    step ${i + 1}/${task.steps.length}: ${step.slice(0, 60)}...\n`);
      lastOutput = runCommand(step, 45000);
    }

    const passed = judge(task.judge, lastOutput);

    // Run cleanup steps (if publish type and cleanup defined)
    let cleanupResult: string | undefined;
    if (task.cleanup && task.cleanup.length > 0) {
      process.stderr.write(`    cleanup: ${task.cleanup.length} steps...\n`);
      let cleanupOutput = '';
      for (const step of task.cleanup) {
        cleanupOutput = runCommand(step, 30000);
      }
      cleanupResult = cleanupOutput.slice(0, 100);
    }

    return {
      name: task.name,
      platform: task.platform,
      taskType: task.type,
      passed,
      duration: Date.now() - start,
      cleanupResult,
      error: passed ? undefined : `Output: ${lastOutput.slice(0, 150)}`,
    };
  } catch (err: any) {
    return {
      name: task.name,
      platform: task.platform,
      taskType: task.type,
      passed: false,
      duration: Date.now() - start,
      error: err.message?.slice(0, 150),
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;
  const filterType = args.includes('--type') ? args[args.indexOf('--type') + 1] : null;
  const filterPlatform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : null;

  const allTasks: PublishTask[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
  let tasks = allTasks;

  if (singleTask) tasks = tasks.filter(t => t.name === singleTask);
  if (filterType) tasks = tasks.filter(t => t.type === filterType);
  if (filterPlatform) tasks = tasks.filter(t => t.platform === filterPlatform);

  if (tasks.length === 0) {
    console.error(`No tasks matched filters: task=${singleTask}, type=${filterType}, platform=${filterPlatform}`);
    process.exit(1);
  }

  const fillTasks = tasks.filter(t => t.type === 'fill-only');
  const publishTasks = tasks.filter(t => t.type === 'publish');

  console.log(`\n📝 Layer 5: Publish Testing — ${tasks.length} tasks`);
  console.log(`   fill-only: ${fillTasks.length} | publish: ${publishTasks.length}`);
  console.log(`   platforms: ${[...new Set(tasks.map(t => t.platform))].join(', ')}\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const icon = task.type === 'publish' ? '🚀' : '📋';
    process.stdout.write(`  [${i + 1}/${tasks.length}] ${icon} ${task.name} (${task.platform})...`);

    const result = runTask(task);
    results.push(result);

    const status = result.passed ? '✓' : '✗';
    const cleanup = result.cleanupResult ? ` [cleanup: ${result.cleanupResult.slice(0, 30)}]` : '';
    console.log(` ${status} (${(result.duration / 1000).toFixed(1)}s)${cleanup}`);

    // Close browser between tasks for clean state
    if (i < tasks.length - 1) {
      try { runCommand('opencli browser close'); } catch { /* ignore */ }
    }
  }

  // Final close
  try { runCommand('opencli browser close'); } catch { /* ignore */ }

  // Summary
  const totalPassed = results.filter(r => r.passed).length;
  const fillPassed = results.filter(r => r.taskType === 'fill-only' && r.passed).length;
  const publishPassed = results.filter(r => r.taskType === 'publish' && r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  const fillTotal = results.filter(r => r.taskType === 'fill-only').length;
  const publishTotal = results.filter(r => r.taskType === 'publish').length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:  ${totalPassed}/${results.length}`);
  console.log(`    fill-only: ${fillPassed}/${fillTotal}`);
  console.log(`    publish:   ${publishPassed}/${publishTotal}`);
  console.log(`  Time:   ${Math.round(totalDuration / 1000)}s`);

  // Platform breakdown
  const platforms = [...new Set(results.map(r => r.platform))];
  for (const p of platforms) {
    const pr = results.filter(r => r.platform === p);
    const pp = pr.filter(r => r.passed).length;
    console.log(`    ${p}: ${pp}/${pr.length}`);
  }

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name} [${f.platform}/${f.taskType}]: ${f.error ?? 'unknown'}`);
    }
  }
  console.log('');

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('publish-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `publish-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    fillScore: `${fillPassed}/${fillTotal}`,
    publishScore: `${publishPassed}/${publishTotal}`,
    duration: `${Math.round(totalDuration / 1000)}s`,
    tasks: results,
  }, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
