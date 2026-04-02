#!/usr/bin/env npx tsx
/**
 * /autoresearch:debug — Hypothesis-driven debugging for specific failing tasks.
 *
 * Scientific method: Gather → Hypothesize → Test → Classify → Log → Repeat
 *
 * Usage:
 *   npx tsx autoresearch/commands/debug.ts --task extract-npm-description
 *   npx tsx autoresearch/commands/debug.ts --task bench-imdb-matrix --iterations 5
 */

import { execSync } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TASKS_FILE = join(__dirname, '..', 'browse-tasks.json');
const DEBUG_LOG = join(ROOT, 'debug-results.tsv');

interface BrowseTask {
  name: string;
  steps: string[];
  judge: { type: string; value?: string; minLength?: number; pattern?: string };
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: ROOT, timeout: 30_000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() ?? err.message ?? '';
  }
}

function initLog(): void {
  if (!existsSync(DEBUG_LOG)) {
    writeFileSync(DEBUG_LOG, '# AutoResearch Debug Log\niteration\ttask\thypothesis\tresult\tverdict\tdescription\n', 'utf-8');
  }
}

function appendLog(iteration: number, task: string, hypothesis: string, result: string, verdict: string, description: string): void {
  appendFileSync(DEBUG_LOG, `${iteration}\t${task}\t${hypothesis}\t${result}\t${verdict}\t${description}\n`, 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskName = args.task;
  const maxIterations = args.iterations ?? 10;

  if (!taskName) {
    console.error('Usage: npx tsx autoresearch/commands/debug.ts --task <task-name> [--iterations N]');
    console.error('\nAvailable tasks:');
    const tasks: BrowseTask[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
    // Show only failing tasks
    for (const task of tasks) {
      try { exec('opencli operate close'); } catch {}
      let lastOutput = '';
      for (const step of task.steps) lastOutput = exec(step);
      const passed = lastOutput.trim().length > 0; // simplified check
      if (!passed) console.error(`  ✗ ${task.name}`);
    }
    process.exit(1);
  }

  const tasks: BrowseTask[] = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
  const task = tasks.find(t => t.name === taskName);
  if (!task) {
    console.error(`Task not found: ${taskName}`);
    process.exit(1);
  }

  console.log(`\n🔍 AutoResearch Debug: ${taskName}`);
  console.log(`   Steps: ${task.steps.length}`);
  console.log(`   Judge: ${task.judge.type}${task.judge.value ? ` "${task.judge.value}"` : ''}`);
  console.log(`   Max iterations: ${maxIterations}\n`);

  initLog();

  // Phase 1: Gather — run the task and capture output
  console.log('Phase 1: Gathering symptoms...');
  try { exec('opencli operate close'); } catch {}

  let lastOutput = '';
  for (let i = 0; i < task.steps.length; i++) {
    const step = task.steps[i];
    console.log(`  Step ${i + 1}: ${step.slice(0, 80)}`);
    lastOutput = exec(step);
    if (i < task.steps.length - 1) {
      console.log(`    → ${lastOutput.slice(0, 100)}`);
    }
  }
  console.log(`\n  Final output: ${lastOutput.slice(0, 200)}`);
  console.log(`  Judge expects: ${JSON.stringify(task.judge)}`);

  // Phase 2: Hypothesize + investigate via Claude Code
  for (let iter = 1; iter <= maxIterations; iter++) {
    console.log(`\n━━━ Debug Iteration ${iter}/${maxIterations} ━━━`);

    const prompt = `You are debugging a failing browser automation task.

## Task: ${taskName}
Steps:
${task.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}

## Judge criteria
${JSON.stringify(task.judge)}

## Last output
${lastOutput.slice(0, 500)}

## Instructions
1. Form a SPECIFIC, FALSIFIABLE hypothesis about why this task fails
2. Run the MINIMUM experiment to test your hypothesis (e.g. run one step, check output)
3. Classify: CONFIRMED (bug found), DISPROVEN (try different hypothesis), INCONCLUSIVE
4. If CONFIRMED: describe the root cause and suggest a fix
5. Output format: one line "HYPOTHESIS: ...", one line "RESULT: CONFIRMED|DISPROVEN|INCONCLUSIVE — ..."

Do NOT fix the code — just diagnose. Use opencli operate commands to investigate.`;

    try {
      const result = execSync(
        `claude -p --dangerously-skip-permissions --allowedTools "Bash(opencli:*),Bash(npm:*),Read,Grep,Glob" --output-format text --no-session-persistence "${prompt.replace(/"/g, '\\"')}"`,
        { cwd: ROOT, timeout: 120_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

      // Extract hypothesis and result
      const hypMatch = result.match(/HYPOTHESIS:\s*(.+)/i);
      const resMatch = result.match(/RESULT:\s*(CONFIRMED|DISPROVEN|INCONCLUSIVE)\s*[-—]\s*(.+)/i);

      const hypothesis = hypMatch?.[1]?.trim() ?? 'unknown';
      const verdict = resMatch?.[1]?.trim() ?? 'INCONCLUSIVE';
      const description = resMatch?.[2]?.trim() ?? result.split('\n').pop()?.trim() ?? '';

      console.log(`  Hypothesis: ${hypothesis.slice(0, 100)}`);
      console.log(`  Verdict: ${verdict} — ${description.slice(0, 100)}`);

      appendLog(iter, taskName, hypothesis, lastOutput.slice(0, 50), verdict, description);

      if (verdict === 'CONFIRMED') {
        console.log(`\n✅ Root cause found at iteration ${iter}!`);
        console.log(`   ${description}`);
        break;
      }
    } catch (err: any) {
      console.error(`  Error: ${err.message?.slice(0, 100)}`);
      appendLog(iter, taskName, 'error', '', 'CRASH', err.message?.slice(0, 80) ?? '');
    }

    // Re-run task for fresh output
    try { exec('opencli operate close'); } catch {}
    for (const step of task.steps) lastOutput = exec(step);
  }

  try { exec('opencli operate close'); } catch {}
  console.log(`\nDebug log saved to: ${DEBUG_LOG}\n`);
}

main();
