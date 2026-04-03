#!/usr/bin/env npx tsx
/**
 * Layer 4: Save as CLI Testing — "Save as CLI" Pipeline
 *
 * Tests the full operate init → write adapter → operate verify flow.
 * Validates that browser exploration can be crystallized into reusable CLI adapters.
 *
 * Usage:
 *   npx tsx autoresearch/eval-save.ts              # Run all tasks
 *   npx tsx autoresearch/eval-save.ts --task hn-top # Run single task
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = join(__dirname, 'save-tasks.json');
const RESULTS_DIR = join(__dirname, 'results');
const USER_CLIS_DIR = join(homedir(), '.opencli', 'clis');

interface SedimentTask {
  name: string;
  site: string;
  command: string;
  adapter: string;
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
  phase: 'init' | 'write' | 'verify' | 'judge';
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
        // operate verify outputs table text; try JSON parse first, then count non-empty lines
        try {
          const arr = JSON.parse(output);
          if (Array.isArray(arr)) return arr.length >= criteria.minLength;
        } catch { /* not JSON — try line counting */ }
        // Table output: count data rows (skip header, separator, empty lines)
        const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('─') && !l.startsWith('┌') && !l.startsWith('└') && !l.startsWith('├'));
        // Subtract header row
        const dataLines = lines.length > 1 ? lines.length - 1 : 0;
        return dataLines >= criteria.minLength;
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

const PROJECT_ROOT = join(__dirname, '..');

/** Run a command, using local dist/main.js instead of global opencli for consistency */
function runCommand(cmd: string, timeout = 30000): string {
  // Use local build so tests always run against the current source
  const localCmd = cmd.replace(/^opencli /, `node dist/main.js `);
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

function cleanupAdapter(site: string, command: string): void {
  const siteDir = join(USER_CLIS_DIR, site);
  const filePath = join(siteDir, `${command}.ts`);
  try {
    if (existsSync(filePath)) rmSync(filePath);
    // Remove site dir if empty
    if (existsSync(siteDir)) {
      const remaining = readdirSync(siteDir);
      if (remaining.length === 0) rmSync(siteDir, { recursive: true });
    }
  } catch { /* best effort */ }
}

function runTask(task: SedimentTask): TaskResult {
  const start = Date.now();
  const { site, command } = task;
  const adapterDir = join(USER_CLIS_DIR, site);
  const adapterPath = join(adapterDir, `${command}.ts`);

  // Cleanup any leftover from previous runs
  cleanupAdapter(site, command);

  try {
    // Phase 1: init — create scaffold
    const initOutput = runCommand(`opencli operate init ${site}/${command}`);
    if (!existsSync(adapterPath)) {
      return {
        name: task.name, phase: 'init', passed: false,
        duration: Date.now() - start,
        error: `init failed: file not created. Output: ${initOutput.slice(0, 100)}`,
        set: task.set === 'test' ? 'test' : 'train',
      };
    }

    // Phase 2: write — overwrite scaffold with real adapter code
    writeFileSync(adapterPath, task.adapter, 'utf-8');

    // Phase 3: verify — run the adapter via operate verify
    const verifyOutput = runCommand(
      `opencli operate verify ${site}/${command}`,
      45000, // longer timeout for network calls
    );

    if (verifyOutput.includes('✗ Adapter failed')) {
      return {
        name: task.name, phase: 'verify', passed: false,
        duration: Date.now() - start,
        error: `verify failed: ${verifyOutput.slice(0, 200)}`,
        set: task.set === 'test' ? 'test' : 'train',
      };
    }

    // Phase 4: judge — check output quality
    const passed = judge(task.judge, verifyOutput);

    return {
      name: task.name,
      phase: 'judge',
      passed,
      duration: Date.now() - start,
      error: passed ? undefined : `Judge failed on output: ${verifyOutput.slice(0, 150)}`,
      set: task.set === 'test' ? 'test' : 'train',
    };
  } catch (err: any) {
    return {
      name: task.name, phase: 'verify', passed: false,
      duration: Date.now() - start,
      error: err.message?.slice(0, 150),
      set: task.set === 'test' ? 'test' : 'train',
    };
  } finally {
    // Always cleanup test adapters
    cleanupAdapter(site, command);
  }
}

function main() {
  const args = process.argv.slice(2);
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;

  const allTasks: SedimentTask[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
  const tasks = singleTask ? allTasks.filter(t => t.name === singleTask) : allTasks;

  if (tasks.length === 0) {
    console.error(`Task "${singleTask}" not found.`);
    process.exit(1);
  }

  console.log(`\n🧪 Layer 4: Save as CLI — ${tasks.length} tasks\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] ${task.name}...`);

    const result = runTask(task);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    const phase = result.passed ? '' : ` (${result.phase})`;
    console.log(` ${icon}${phase} (${(result.duration / 1000).toFixed(1)}s)`);
  }

  // Summary
  const trainResults = results.filter(r => r.set === 'train');
  const testResults = results.filter(r => r.set === 'test');
  const totalPassed = results.filter(r => r.passed).length;
  const trainPassed = trainResults.filter(r => r.passed).length;
  const testPassed = testResults.filter(r => r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:  ${totalPassed}/${results.length} (train: ${trainPassed}/${trainResults.length}, test: ${testPassed}/${testResults.length})`);
  console.log(`  Time:   ${Math.round(totalDuration / 1000)}s`);

  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name} [${f.phase}]: ${f.error ?? 'unknown'}`);
    }
  }
  console.log('');

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('save-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `save-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    trainScore: `${trainPassed}/${trainResults.length}`,
    testScore: `${testPassed}/${testResults.length}`,
    duration: `${Math.round(totalDuration / 1000)}s`,
    tasks: results,
  }, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
