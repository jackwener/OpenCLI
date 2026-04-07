#!/usr/bin/env npx tsx
/**
 * /autoresearch:fix — Iterative error elimination.
 *
 * Auto-detects broken state (build → test → browse tests) and iteratively
 * fixes errors one at a time. Stops when error count reaches 0.
 *
 * Priority: build errors → test failures → browse task failures
 *
 * Usage:
 *   npx tsx autoresearch/commands/fix.ts
 *   npx tsx autoresearch/commands/fix.ts --iterations 10
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseArgs } from '../config.js';
import type { CommandSpecsFile } from '../config.js';
import { Engine, type ModifyContext } from '../engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function exec(cmd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: ROOT, timeout: 120_000, encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: (err.stdout ?? '') + '\n' + (err.stderr ?? '') };
  }
}

/** Detect current broken state and return verify command + error count */
function detectBrokenState(): { verify: string; errors: number; description: string } | null {
  // 1. Build
  const build = exec('npm run build 2>&1');
  if (!build.ok) {
    const errorCount = (build.output.match(/error TS/g) || []).length || 1;
    return {
      verify: 'npm run build 2>&1 | grep -c "error TS" || echo 0',
      errors: errorCount,
      description: `${errorCount} TypeScript build error(s)`,
    };
  }

  // 2. Tests
  const test = exec('npm test 2>&1');
  if (!test.ok) {
    const failMatch = test.output.match(/(\d+)\s+fail/i);
    const errorCount = failMatch ? parseInt(failMatch[1], 10) : 1;
    return {
      verify: 'npm test 2>&1 | grep -oP "\\d+(?= fail)" || echo 0',
      errors: errorCount,
      description: `${errorCount} test failure(s)`,
    };
  }

  // 3. Browse tests
  const browse = exec('npx tsx autoresearch/eval-browse.ts 2>&1');
  const scoreMatch = browse.output.match(/SCORE=(\d+)\/(\d+)/);
  if (scoreMatch) {
    const passed = parseInt(scoreMatch[1], 10);
    const total = parseInt(scoreMatch[2], 10);
    const failures = total - passed;
    if (failures > 0) {
      return {
        verify: 'npx tsx autoresearch/eval-browse.ts 2>&1 | tail -1',
        errors: failures,
        description: `${failures} browse task failure(s) (${passed}/${total})`,
      };
    }
  }

  return null; // all clean
}

/** Build incident-mode config for a specific command spec */
function buildIncidentConfig(specName: string, maxIterations: number) {
  const specsFile: CommandSpecsFile = JSON.parse(
    readFileSync(join(__dirname, '..', 'command-specs.json'), 'utf-8')
  );
  const spec = specsFile.specs.find(s => s.name === specName);
  if (!spec) {
    console.error(`Spec "${specName}" not found in command-specs.json`);
    process.exit(1);
  }

  return {
    config: {
      goal: `Fix command regression: ${spec.command}`,
      scope: [...spec.repairScope, 'src/**/*.ts'],
      metric: 'pass_count',
      direction: 'higher' as const,
      verify: `npx tsx autoresearch/eval-cli.ts --spec ${specName} 2>&1 | tail -1`,
      guard: 'npm run build && npm test',
      iterations: maxIterations,
      minDelta: 1,
    },
    spec,
  };
}

function buildIncidentPrompt(specName: string, ctx: ModifyContext): string {
  const specsFile: CommandSpecsFile = JSON.parse(
    readFileSync(join(__dirname, '..', 'command-specs.json'), 'utf-8')
  );
  const spec = specsFile.specs.find(s => s.name === specName);
  if (!spec) return 'Fix the failing command.';

  const forbidden = spec.forbidden.length > 0
    ? `Do NOT modify: ${spec.forbidden.join(', ')}`
    : '';

  return `Command \`${spec.command}\` is failing (regression).

Current pass count: ${ctx.currentMetric}. Goal: all verify checks pass.

The command implementation is at: ${spec.repairScope.join(', ')}
Read the adapter code, understand why the command fails against the live site, and fix it.

Common causes:
- Site updated DOM selectors
- URL pattern changed
- Response format changed
- Auth/cookie handling broke

${forbidden}
Fix ONE issue at a time.

${ctx.stuckHint ? `STUCK HINT: ${ctx.stuckHint}` : ''}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxIterations = args.iterations ?? 20;
  const mode = args.mode ?? 'repo';
  const specName = args.spec;

  if (mode === 'incident') {
    if (!specName) {
      console.error('Incident mode requires --spec <name>');
      process.exit(1);
    }

    console.log(`\n🔧 AutoResearch Fix — Incident Mode: ${specName}\n`);

    const { config } = buildIncidentConfig(specName, maxIterations);

    console.log(`  Command spec: ${specName}`);
    console.log(`  Verify: ${config.verify}`);
    console.log(`  Scope: ${config.scope.join(', ')}\n`);

    const logPath = join(ROOT, 'autoresearch-results.tsv');
    const engine = new Engine(config, logPath, {
      modify: async (ctx: ModifyContext) => {
        const prompt = buildIncidentPrompt(specName, ctx);
        try {
          const result = execSync(
            `claude -p --dangerously-skip-permissions --allowedTools "Bash(npm:*),Bash(npx:*),Read,Edit,Write,Glob,Grep" --output-format text --no-session-persistence "${prompt.replace(/"/g, '\\"')}"`,
            { cwd: ROOT, timeout: 180_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim();
          const lines = result.split('\n').filter(l => l.trim());
          return lines[lines.length - 1]?.trim()?.slice(0, 120) || 'incident fix attempt';
        } catch {
          return null;
        }
      },
      onStatus: (msg) => console.log(msg),
    });

    try {
      const results = await engine.run();
      const finalMetric = results[results.length - 1]?.metric ?? 0;
      if (finalMetric > 0) {
        console.log(`\n✅ Command spec "${specName}" passing!\n`);
      } else {
        console.log(`\n⚠ Command spec "${specName}" still failing after ${maxIterations} iterations.\n`);
      }
    } catch (err: any) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // ── Repo mode (default, existing behavior) ──
  console.log('\n🔧 AutoResearch Fix — Detecting broken state...\n');

  const broken = detectBrokenState();
  if (!broken) {
    console.log('  ✓ All clean — nothing to fix!\n');
    return;
  }

  console.log(`  Found: ${broken.description}`);
  console.log(`  Verify: ${broken.verify}\n`);

  const config = {
    goal: `Fix all errors: ${broken.description}`,
    scope: ['src/**/*.ts', 'extension/src/**/*.ts'],
    metric: 'error_count',
    direction: 'lower' as const,
    verify: broken.verify,
    guard: 'npm run build',
    iterations: maxIterations,
    minDelta: 1,
  };

  const logPath = join(ROOT, 'autoresearch-results.tsv');
  const engine = new Engine(config, logPath, {
    modify: async (ctx: ModifyContext) => {
      const prompt = `Fix ONE error. Current error count: ${ctx.currentMetric}. Goal: 0 errors.

Read the error output, understand the root cause, and make ONE focused fix.
Do NOT fix multiple unrelated errors at once.
Do NOT modify test files.

${ctx.stuckHint ? `STUCK HINT: ${ctx.stuckHint}` : ''}`;

      try {
        // Pass prompt via stdin `input` option to avoid shell metacharacter expansion
        const result = execSync(
          'claude -p --dangerously-skip-permissions --allowedTools "Bash(npm:*),Bash(npx:*),Read,Edit,Write,Glob,Grep" --output-format text --no-session-persistence',
          { cwd: ROOT, timeout: 180_000, encoding: 'utf-8', input: prompt, stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        const lines = result.split('\n').filter(l => l.trim());
        return lines[lines.length - 1]?.trim()?.slice(0, 120) || 'fix attempt';
      } catch {
        return null;
      }
    },
    onStatus: (msg) => console.log(msg),
  });

  try {
    const results = await engine.run();
    const finalMetric = results[results.length - 1]?.metric ?? broken.errors;
    if (finalMetric === 0) {
      console.log('\n✅ All errors fixed!\n');
    } else {
      console.log(`\n⚠ ${finalMetric} error(s) remaining after ${maxIterations} iterations.\n`);
    }
  } catch (err: any) {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  }
}

main();
