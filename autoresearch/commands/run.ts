#!/usr/bin/env npx tsx
/**
 * /autoresearch — Main autonomous iteration loop.
 *
 * Usage:
 *   npx tsx autoresearch/commands/run.ts --preset browser-reliability
 *   npx tsx autoresearch/commands/run.ts --preset browser-reliability --iterations 5
 *   npx tsx autoresearch/commands/run.ts --goal "..." --scope "src/*.ts" --verify "..." --iterations 10
 *
 * The modify callback spawns Claude Code to make ONE atomic change per iteration.
 * Engine handles commit, verify, guard, keep/discard, and logging.
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type AutoResearchConfig } from '../config.js';
import { Engine, type ModifyContext } from '../engine.js';
import { PRESETS } from '../presets/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function buildModifyPrompt(ctx: ModifyContext, config: AutoResearchConfig): string {
  const recent = ctx.recentLog.slice(-10).map(r =>
    `  ${r.status.padEnd(12)} ${r.description}`
  ).join('\n');

  return `You are an autonomous improvement agent. Make ONE atomic change to improve this metric.

## Goal
${config.goal}

## Current State
- Metric (${config.metric}): ${ctx.currentMetric} (best: ${ctx.bestMetric})
- Iteration: ${ctx.iteration}
- Consecutive discards: ${ctx.consecutiveDiscards}
${ctx.stuckHint ? `\n## STUCK — Try a Different Approach\n${ctx.stuckHint}` : ''}

## Recent History
${recent || '  (no history yet)'}

## Git Log (recent experiments)
${ctx.gitLog.split('\n').slice(0, 10).join('\n')}

## Scope (files you can modify)
${ctx.scopeFiles.join('\n')}

## Rules
1. Make ONE atomic change (one logical intent, even if multiple files)
2. Read the failing test output or code BEFORE modifying
3. DO NOT modify test files or the verify command
4. Describe what you changed in one sentence (no "and" linking unrelated actions)
5. If previous approach was discarded, try something DIFFERENT
6. Focus on the specific failures — read error messages carefully`;
}

async function modify(ctx: ModifyContext, config: AutoResearchConfig): Promise<string | null> {
  const prompt = buildModifyPrompt(ctx, config);

  console.log('  Claude Code making a change...');
  try {
    const result = execSync(
      `claude -p --dangerously-skip-permissions --allowedTools "Bash(npm:*),Bash(npx:*),Bash(git:*),Read,Edit,Write,Glob,Grep" --output-format text --no-session-persistence "${prompt.replace(/"/g, '\\"')}"`,
      {
        cwd: ROOT,
        timeout: 300_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      }
    ).trim();

    // Extract description from Claude's response (last non-empty line or summary)
    const lines = result.split('\n').filter(l => l.trim());
    const desc = lines[lines.length - 1]?.trim() || 'change made by Claude Code';
    return desc.slice(0, 120);
  } catch (err: any) {
    console.error('  Claude Code failed:', err.message?.slice(0, 100));
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve config from preset or CLI args
  let config: AutoResearchConfig;
  if (args.preset) {
    config = PRESETS[args.preset];
    if (!config) {
      console.error(`Unknown preset: ${args.preset}`);
      console.error(`Available: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    // Allow CLI overrides
    if (args.iterations != null) config = { ...config, iterations: args.iterations };
    if (args.guard != null) config = { ...config, guard: args.guard };
  } else if (args.goal && args.verify) {
    config = {
      goal: args.goal,
      scope: args.scope ?? ['src/**/*.ts'],
      metric: args.metric ?? 'score',
      direction: args.direction ?? 'higher',
      verify: args.verify,
      guard: args.guard,
      iterations: args.iterations,
      minDelta: args.minDelta,
    };
  } else {
    console.error('Usage: npx tsx autoresearch/commands/run.ts --preset <name> [--iterations N]');
    console.error('   or: npx tsx autoresearch/commands/run.ts --goal "..." --verify "..." --scope "..."');
    console.error(`\nAvailable presets: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🔬 AutoResearch: ${config.goal}`);
  console.log(`   Metric: ${config.metric} (${config.direction})`);
  console.log(`   Verify: ${config.verify}`);
  console.log(`   Guard:  ${config.guard ?? '(none)'}`);
  console.log(`   Iterations: ${config.iterations ?? '∞'}`);
  console.log('');

  const logPath = join(ROOT, 'autoresearch-results.tsv');
  const engine = new Engine(config, logPath, {
    modify: (ctx) => modify(ctx, config),
    onStatus: (msg) => console.log(msg),
  });

  try {
    await engine.run();
  } catch (err: any) {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  }
}

main();
