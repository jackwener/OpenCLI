#!/usr/bin/env npx tsx
/**
 * AutoResearch Evaluation Runner
 *
 * Runs all tasks in tasks.json against the current `opencli operate` build,
 * judges each result, and outputs a score report.
 *
 * Usage:
 *   npx tsx autoresearch/eval.ts                    # Run all tasks
 *   npx tsx autoresearch/eval.ts --train-only       # Run only train set (15 tasks)
 *   npx tsx autoresearch/eval.ts --test-only        # Run only test set (5 tasks)
 *   npx tsx autoresearch/eval.ts --task example-title  # Run a single task
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASKS_FILE = join(__dirname, 'tasks.json');
const RESULTS_DIR = join(__dirname, 'results');
const BASELINE_FILE = join(__dirname, 'baseline.txt');

// ── Types ──────────────────────────────────────────────────────────

interface TaskDef {
  name: string;
  command: string;
  url?: string;
  maxSteps?: number;
  judge: JudgeCriteria;
  set?: 'test'; // omitted = train
}

type JudgeCriteria =
  | { type: 'contains'; field: string; value: string }
  | { type: 'arrayMinLength'; field: string; minLength: number }
  | { type: 'arrayFieldsPresent'; field: string; minLength: number; requiredFields: string[] }
  | { type: 'nonEmpty'; field: string }
  | { type: 'matchesPattern'; field: string; pattern: string }
  | { type: 'successTrue' };

interface TaskResult {
  name: string;
  passed: boolean;
  steps: number;
  cost: number;
  error?: string;
  duration: number;
  set: 'train' | 'test';
}

interface EvalResult {
  timestamp: string;
  score: string;
  trainScore: string;
  testScore: string;
  tasks: TaskResult[];
  totalCost: number;
  duration: string;
}

// ── Judge Functions ────────────────────────────────────────────────

function judge(criteria: JudgeCriteria, result: any): boolean {
  try {
    if (criteria.type === 'successTrue') {
      return result.success === true;
    }

    const data = getField(result, criteria.field);

    switch (criteria.type) {
      case 'contains': {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        return str.toLowerCase().includes(criteria.value.toLowerCase());
      }
      case 'arrayMinLength': {
        if (Array.isArray(data)) return data.length >= criteria.minLength;
        // extractedData might be a stringified array or object with array field
        const parsed = tryParseArray(data);
        return parsed !== null && parsed.length >= criteria.minLength;
      }
      case 'arrayFieldsPresent': {
        let arr = Array.isArray(data) ? data : tryParseArray(data);
        if (!arr || arr.length < criteria.minLength) return false;
        return arr.slice(0, criteria.minLength).every((item: any) =>
          criteria.requiredFields.every(f => item[f] !== undefined && item[f] !== null && item[f] !== '')
        );
      }
      case 'nonEmpty': {
        if (data === null || data === undefined) return false;
        if (typeof data === 'string') return data.trim().length > 0;
        if (Array.isArray(data)) return data.length > 0;
        if (typeof data === 'object') return Object.keys(data).length > 0;
        return true;
      }
      case 'matchesPattern': {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        return new RegExp(criteria.pattern).test(str);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function getField(obj: any, field: string): any {
  if (!obj) return undefined;
  return obj[field];
}

function tryParseArray(data: any): any[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
      // Look for array inside parsed object
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) return val as any[];
      }
    } catch { /* not JSON */ }
  }
  if (typeof data === 'object' && data !== null) {
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) return val as any[];
    }
  }
  return null;
}

// ── Run a single task ──────────────────────────────────────────────

function runTask(task: TaskDef): TaskResult {
  const maxSteps = task.maxSteps ?? 10;
  const start = Date.now();

  const args = [
    'node', 'dist/main.js', 'operate',
    ...(task.url ? ['--url', task.url] : []),
    '--max-steps', String(maxSteps),
    '--model', process.env.AUTORESEARCH_MODEL ?? 'claude-sonnet-4-20250514',
    JSON.stringify(task.command),
  ];

  let output: string;
  try {
    output = execSync(args.join(' '), {
      cwd: join(__dirname, '..'),
      timeout: maxSteps * 30_000, // 30s per step max
      encoding: 'utf-8',
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    // Command failed but may still have output
    output = err.stdout ?? '';
  }

  const duration = Date.now() - start;

  // Parse the result from CLI output
  const result = parseOperateOutput(output);

  const passed = judge(task.judge, result);

  return {
    name: task.name,
    passed,
    steps: result?.stepsCompleted ?? 0,
    cost: result?.tokenUsage?.estimatedCost ?? 0,
    error: passed ? undefined : (result?.result ?? 'unknown failure').slice(0, 200),
    duration,
    set: task.set === 'test' ? 'test' : 'train',
  };
}

function parseOperateOutput(output: string): any {
  // The CLI outputs structured info. Try to extract key fields.
  const result: any = { success: false };

  if (output.includes('✓ Task completed successfully')) {
    result.success = true;
  }

  // Extract "Steps: N" from the stats line
  const stepsMatch = output.match(/Steps:\s*(\d+)/);
  if (stepsMatch) result.stepsCompleted = parseInt(stepsMatch[1], 10);

  // Extract cost
  const costMatch = output.match(/Cost:\s*~\$([0-9.]+)/);
  if (costMatch) result.tokenUsage = { estimatedCost: parseFloat(costMatch[1]) };

  // Extract "Extracted data:" section
  const dataMatch = output.match(/Extracted data:\n([\s\S]*?)(?:\n\n|\nSteps:)/);
  if (dataMatch) {
    const dataStr = dataMatch[1].trim();
    try {
      result.extractedData = JSON.parse(dataStr);
    } catch {
      result.extractedData = dataStr;
    }
  }

  // Extract result text (line after ✓ or ✗)
  const resultMatch = output.match(/[✓✗] .+\n\n(.+)/);
  if (resultMatch) result.result = resultMatch[1].trim();

  return result;
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const trainOnly = args.includes('--train-only');
  const testOnly = args.includes('--test-only');
  const singleTask = args.includes('--task') ? args[args.indexOf('--task') + 1] : null;

  const allTasks: TaskDef[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));

  let tasks: TaskDef[];
  if (singleTask) {
    tasks = allTasks.filter(t => t.name === singleTask);
    if (tasks.length === 0) {
      console.error(`Task "${singleTask}" not found. Available: ${allTasks.map(t => t.name).join(', ')}`);
      process.exit(1);
    }
  } else if (trainOnly) {
    tasks = allTasks.filter(t => t.set !== 'test');
  } else if (testOnly) {
    tasks = allTasks.filter(t => t.set === 'test');
  } else {
    tasks = allTasks;
  }

  console.log(`\n🔬 AutoResearch Eval — ${tasks.length} tasks\n`);

  const results: TaskResult[] = [];
  const evalStart = Date.now();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] ${task.name}...`);

    const result = runTask(task);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    const costStr = result.cost > 0 ? ` ($${result.cost.toFixed(3)})` : '';
    console.log(` ${icon} ${result.steps} steps, ${Math.round(result.duration / 1000)}s${costStr}`);
  }

  const evalDuration = Date.now() - evalStart;

  // Calculate scores
  const trainResults = results.filter(r => r.set === 'train');
  const testResults = results.filter(r => r.set === 'test');
  const totalPassed = results.filter(r => r.passed).length;
  const trainPassed = trainResults.filter(r => r.passed).length;
  const testPassed = testResults.filter(r => r.passed).length;
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

  const evalResult: EvalResult = {
    timestamp: new Date().toISOString(),
    score: `${totalPassed}/${results.length}`,
    trainScore: `${trainPassed}/${trainResults.length}`,
    testScore: `${testPassed}/${testResults.length}`,
    tasks: results,
    totalCost,
    duration: `${Math.round(evalDuration / 60000)}min`,
  };

  // Print summary
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:  ${evalResult.score} (train: ${evalResult.trainScore}, test: ${evalResult.testScore})`);
  console.log(`  Cost:   $${totalCost.toFixed(3)}`);
  console.log(`  Time:   ${evalResult.duration}`);

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
  const existingRounds = readdirSync(RESULTS_DIR).filter(f => f.startsWith('round-')).length;
  const roundNum = String(existingRounds + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `round-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify(evalResult, null, 2), 'utf-8');
  console.log(`  Results saved to: ${resultPath}`);

  // Output score for scripting
  console.log(`\nSCORE=${totalPassed}/${results.length}`);
}

main();
