#!/usr/bin/env npx tsx
/**
 * eval-cli.ts — Command-level smoke / incident verification runner.
 *
 * Executes CommandIncidentSpecs from command-specs.json and reports
 * pass/fail with failure taxonomy (regression vs precondition vs infra).
 *
 * Usage:
 *   npx tsx autoresearch/eval-cli.ts                     # Run all specs
 *   npx tsx autoresearch/eval-cli.ts --spec weibo-hot-smoke  # Run single spec
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandSpecsFile, CommandIncidentSpec, SpecClassification, SpecResult, VerifyCheck } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SPECS_FILE = join(__dirname, 'command-specs.json');
const RESULTS_DIR = join(__dirname, 'results');

const COMMAND_TIMEOUT = 60_000;

/* ── Prerequisite checking ── */

function checkPrerequisites(spec: CommandIncidentSpec): { ok: boolean; reason: string } {
  const prereqs = spec.prerequisites;
  if (!prereqs) return { ok: true, reason: '' };

  // Check env vars
  if (prereqs.env) {
    for (const [key, value] of Object.entries(prereqs.env)) {
      if (process.env[key] !== value) {
        return { ok: false, reason: `Missing env var: ${key}=${value}` };
      }
    }
  }

  // Auth check: we can't verify cookies directly, so we check if the browser
  // bridge is reachable. For auth-required specs, we mark as precondition
  // failure if no browser profile is available. For now, auth specs with
  // prerequisites.auth are allowed to proceed — they'll fail as regression
  // if cookies are actually missing and the command errors out.
  // This is intentionally lenient for Phase 1.

  return { ok: true, reason: '' };
}

/* ── Command execution ── */

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

function execCommand(command: string, env?: Record<string, string>): ExecResult {
  try {
    const stdout = execSync(command, {
      cwd: PROJECT_ROOT,
      timeout: COMMAND_TIMEOUT,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { stdout, stderr: '', exitCode: 0, timedOut: false };
  } catch (err: any) {
    if (err.killed || err.signal === 'SIGTERM') {
      return {
        stdout: err.stdout?.trim() ?? '',
        stderr: err.stderr?.trim() ?? '',
        exitCode: err.status ?? 1,
        timedOut: true,
      };
    }
    return {
      stdout: err.stdout?.trim() ?? '',
      stderr: err.stderr?.trim() ?? '',
      exitCode: err.status ?? 1,
      timedOut: false,
    };
  }
}

/* ── Verify checks ── */

function applyVerifyCheck(check: VerifyCheck, result: ExecResult): { passed: boolean; reason: string } {
  switch (check.type) {
    case 'exitCode':
      return {
        passed: result.exitCode === check.expected,
        reason: `exitCode: expected ${check.expected}, got ${result.exitCode}`,
      };

    case 'stdoutContains':
      return {
        passed: result.stdout.includes(check.value),
        reason: `stdout does not contain "${check.value}"`,
      };

    case 'jsonField': {
      try {
        const data = JSON.parse(result.stdout);
        const value = resolveJsonPath(data, check.path);
        switch (check.matcher) {
          case 'nonEmpty':
            return {
              passed: value !== null && value !== undefined && value !== '',
              reason: `jsonField "${check.path}" is empty`,
            };
          case 'contains':
            return {
              passed: String(value).includes(check.value ?? ''),
              reason: `jsonField "${check.path}" does not contain "${check.value}"`,
            };
          case 'gte':
            return {
              passed: Number(value) >= Number(check.value ?? 0),
              reason: `jsonField "${check.path}" = ${value}, expected >= ${check.value}`,
            };
          case 'matches':
            return {
              passed: new RegExp(check.value ?? '').test(String(value)),
              reason: `jsonField "${check.path}" does not match /${check.value}/`,
            };
          default:
            return { passed: false, reason: `Unknown matcher: ${(check as any).matcher}` };
        }
      } catch (e) {
        return { passed: false, reason: `Failed to parse JSON: ${(e as Error).message}` };
      }
    }

    default:
      return { passed: false, reason: `Unknown verify check type: ${(check as any).type}` };
  }
}

function resolveJsonPath(data: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/* ── Spec runner ── */

function runSpec(spec: CommandIncidentSpec, allowSideEffects: boolean): SpecResult {
  const start = Date.now();

  // Safety check
  if (spec.safety === 'publish' && !allowSideEffects) {
    return {
      name: spec.name,
      classification: 'skipped',
      duration: Date.now() - start,
      failedChecks: ['publish spec requires --allow-side-effects'],
    };
  }

  // Prerequisite check
  const prereqResult = checkPrerequisites(spec);
  if (!prereqResult.ok) {
    return {
      name: spec.name,
      classification: 'failed_precondition',
      duration: Date.now() - start,
      failedChecks: [prereqResult.reason],
    };
  }

  // Setup steps
  if (spec.setup) {
    for (const step of spec.setup) {
      execCommand(step);
    }
  }

  // Build env for execution
  const env: Record<string, string> = {};
  if (spec.safety === 'fill_only') {
    env.OPENCLI_DRY_RUN = '1';
  }

  // Execute command
  const result = execCommand(spec.command, env);

  // Infrastructure failure detection
  if (result.timedOut) {
    return {
      name: spec.name,
      classification: 'failed_infrastructure',
      duration: Date.now() - start,
      failedChecks: ['Command timed out'],
      stdout: result.stdout.slice(0, 500),
      stderr: result.stderr.slice(0, 500),
      exitCode: result.exitCode,
    };
  }

  const infraPatterns = [
    'browser bridge',
    'ECONNREFUSED',
    'CDP connect timeout',
    'No browser',
    'connect ECONNREFUSED',
  ];
  const combinedOutput = `${result.stdout} ${result.stderr}`.toLowerCase();
  for (const pattern of infraPatterns) {
    if (combinedOutput.includes(pattern.toLowerCase())) {
      return {
        name: spec.name,
        classification: 'failed_infrastructure',
        duration: Date.now() - start,
        failedChecks: [`Infrastructure error: ${pattern}`],
        stdout: result.stdout.slice(0, 500),
        stderr: result.stderr.slice(0, 500),
        exitCode: result.exitCode,
      };
    }
  }

  // Apply verify checks
  const failedChecks: string[] = [];
  for (const check of spec.verify) {
    const checkResult = applyVerifyCheck(check, result);
    if (!checkResult.passed) {
      failedChecks.push(checkResult.reason);
    }
  }

  // Cleanup
  if (spec.cleanup) {
    for (const step of spec.cleanup) {
      try { execCommand(step); } catch { /* ignore cleanup failures */ }
    }
  }

  if (failedChecks.length === 0) {
    return {
      name: spec.name,
      classification: 'passed',
      duration: Date.now() - start,
    };
  }

  return {
    name: spec.name,
    classification: 'failed_regression',
    duration: Date.now() - start,
    failedChecks,
    stdout: result.stdout.slice(0, 500),
    stderr: result.stderr.slice(0, 500),
    exitCode: result.exitCode,
  };
}

/* ── Main ── */

function main() {
  const args = process.argv.slice(2);
  const specFilter = args.includes('--spec') ? args[args.indexOf('--spec') + 1] : null;
  const allowSideEffects = args.includes('--allow-side-effects');

  const specsFile: CommandSpecsFile = JSON.parse(readFileSync(SPECS_FILE, 'utf-8'));
  const specs = specFilter
    ? specsFile.specs.filter(s => s.name === specFilter)
    : specsFile.specs;

  if (specs.length === 0) {
    console.error(`Spec "${specFilter}" not found.`);
    process.exit(1);
  }

  console.log(`\n🔬 eval-cli — ${specs.length} command spec(s)\n`);

  const results: SpecResult[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    process.stdout.write(`  [${i + 1}/${specs.length}] ${spec.name} (${spec.safety})...`);

    const result = runSpec(spec, allowSideEffects);
    results.push(result);

    const icons: Record<SpecClassification, string> = {
      passed: '✓',
      failed_regression: '✗',
      failed_precondition: '⊘',
      failed_infrastructure: '⚡',
      skipped: '─',
    };
    console.log(` ${icons[result.classification]} ${result.classification} (${(result.duration / 1000).toFixed(1)}s)`);
  }

  // Summary
  const passed = results.filter(r => r.classification === 'passed').length;
  const regressions = results.filter(r => r.classification === 'failed_regression').length;
  const preconditions = results.filter(r => r.classification === 'failed_precondition').length;
  const infra = results.filter(r => r.classification === 'failed_infrastructure').length;
  const skipped = results.filter(r => r.classification === 'skipped').length;
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  // Score only counts passed + regression (excludes precondition/infra/skipped)
  const scoreDenominator = passed + regressions;
  const scoreNumerator = passed;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Score:         ${scoreNumerator}/${scoreDenominator}`);
  console.log(`  Passed:        ${passed}`);
  console.log(`  Regression:    ${regressions}`);
  console.log(`  Precondition:  ${preconditions}`);
  console.log(`  Infrastructure: ${infra}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Time:          ${(totalDuration / 1000).toFixed(1)}s`);

  // Show regression details
  const regressionResults = results.filter(r => r.classification === 'failed_regression');
  if (regressionResults.length > 0) {
    console.log(`\n  Regressions:`);
    for (const r of regressionResults) {
      console.log(`    ✗ ${r.name}:`);
      for (const check of r.failedChecks ?? []) {
        console.log(`      - ${check}`);
      }
    }
  }
  console.log('');

  // Save result
  mkdirSync(RESULTS_DIR, { recursive: true });
  const existing = readdirSync(RESULTS_DIR).filter(f => f.startsWith('cli-')).length;
  const roundNum = String(existing + 1).padStart(3, '0');
  const resultPath = join(RESULTS_DIR, `cli-${roundNum}.json`);
  writeFileSync(resultPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    score: `${scoreNumerator}/${scoreDenominator}`,
    summary: { passed, failed_regression: regressions, failed_precondition: preconditions, failed_infrastructure: infra, skipped },
    duration: `${(totalDuration / 1000).toFixed(1)}s`,
    specs: results,
  }, null, 2));

  console.log(`  Results saved: ${resultPath}\n`);

  // Last line: SCORE=X/Y for engine metric extraction
  console.log(`SCORE=${scoreNumerator}/${scoreDenominator}`);
}

main();
