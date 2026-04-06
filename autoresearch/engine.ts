/**
 * AutoResearch Engine — Karpathy's 8-phase autonomous iteration loop.
 *
 * Phase 0: Precondition checks (git clean, no locks)
 * Phase 1: Review (read scope files + log + git history)
 * Phase 2: Ideate (select next change based on history)
 * Phase 3: Modify (one atomic change — delegated to caller)
 * Phase 4: Commit (git add + commit with experiment prefix)
 * Phase 5: Verify (run verify command, extract metric)
 * Phase 5.5: Guard (optional regression check)
 * Phase 6: Decide (keep/discard/crash + rollback)
 * Phase 7: Log (append TSV)
 * Phase 8: Repeat
 */

import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { type AutoResearchConfig, type IterationResult, type IterationStatus, extractMetric } from './config.js';
import { Logger } from './logger.js';

export interface EngineCallbacks {
  /** Called at Phase 2-3: review context, ideate, and make ONE change.
   *  Return a one-sentence description of what was changed, or null to skip. */
  modify(context: ModifyContext): Promise<string | null>;

  /** Called when engine needs to report status */
  onStatus?(msg: string): void;
}

export interface ModifyContext {
  iteration: number;
  bestMetric: number;
  currentMetric: number;
  recentLog: IterationResult[];
  gitLog: string;
  scopeFiles: string[];
  consecutiveDiscards: number;
  stuckHint: string | null;
}

const ROOT = join(import.meta.dirname ?? process.cwd(), '..');

function exec(cmd: string, opts?: { timeout?: number; cwd?: string }): string {
  try {
    return execSync(cmd, {
      cwd: opts?.cwd ?? ROOT,
      timeout: opts?.timeout ?? 120_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() ?? err.message ?? '';
  }
}

function execStrict(cmd: string, opts?: { timeout?: number }): string {
  return execSync(cmd, {
    cwd: ROOT,
    timeout: opts?.timeout ?? 120_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  }).trim();
}

export class Engine {
  private config: AutoResearchConfig;
  private logger: Logger;
  private callbacks: EngineCallbacks;
  private bestMetric: number = 0;
  private currentMetric: number = 0;
  private iteration: number = 0;

  constructor(config: AutoResearchConfig, logPath: string, callbacks: EngineCallbacks) {
    this.config = config;
    this.logger = new Logger(logPath);
    this.callbacks = callbacks;
  }

  private log(msg: string): void {
    this.callbacks.onStatus?.(msg);
  }

  /** Phase 0: Precondition checks */
  private checkPreconditions(): void {
    // Git repo exists
    try { execStrict('git rev-parse --git-dir'); }
    catch { throw new Error('Not a git repository'); }

    // Clean working tree
    const status = exec('git status --porcelain');
    if (status) throw new Error(`Working tree not clean:\n${status}`);

    // No stale locks
    if (existsSync(join(ROOT, '.git', 'index.lock'))) {
      throw new Error('Stale .git/index.lock found — remove it first');
    }

    // Not detached HEAD
    try { execStrict('git symbolic-ref HEAD'); }
    catch { throw new Error('Detached HEAD — checkout a branch first'); }
  }

  /** Phase 5: Run verify command and extract metric */
  private runVerify(): number | null {
    this.log('  verify...');
    const output = exec(this.config.verify, { timeout: 300_000 });
    return extractMetric(output);
  }

  /** Phase 5.5: Run guard command */
  private runGuard(): boolean {
    if (!this.config.guard) return true;
    this.log('  guard...');
    try {
      execStrict(this.config.guard, { timeout: 300_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Phase 4: Commit changes */
  private commit(description: string): string | null {
    if (!this.config.scope.length) return null; // no scope = nothing to stage
    // Stage only files matching scope globs (avoid staging unrelated changes)
    // Try each glob individually — skip globs that don't match any files
    for (const glob of this.config.scope) {
      try {
        execFileSync('git', ['add', '--', glob], {
          cwd: ROOT, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // pathspec didn't match any files — skip silently
      }
    }
    const diff = exec('git diff --cached --quiet; echo $?');
    if (diff === '0') return null; // no changes

    try {
      execFileSync('git', ['commit', '-m', `experiment(operate): ${description}`], {
        cwd: ROOT, timeout: 30_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return exec('git rev-parse --short HEAD');
    } catch {
      // Hook failure
      exec('git reset HEAD');
      return 'hook-blocked';
    }
  }

  /** Phase 6: Rollback */
  private safeRevert(): void {
    try {
      execStrict('git revert HEAD --no-edit');
    } catch {
      exec('git revert --abort');
      exec('git reset --hard HEAD~1');
    }
  }

  /** Get stuck hint when >5 consecutive discards */
  private getStuckHint(discards: number): string | null {
    if (discards < 5) return null;
    const hints = [
      'Re-read ALL scope files from scratch. Try a completely different approach.',
      'Review entire results log — what worked before? Try combining successful changes.',
      'Try the OPPOSITE of what has been failing.',
      'Try a radical architectural change instead of incremental tweaks.',
      'Simplify — remove complexity rather than adding it.',
    ];
    return hints[Math.min(discards - 5, hints.length - 1)];
  }

  /** Run the main loop */
  async run(): Promise<IterationResult[]> {
    const results: IterationResult[] = [];

    // Phase 0: Preconditions
    this.log('Phase 0: Precondition checks...');
    this.checkPreconditions();

    // Initialize logger
    this.logger.init(this.config);

    // Baseline measurement
    this.log('Measuring baseline...');
    const baseline = this.runVerify();
    if (baseline == null) throw new Error('Verify command returned no metric for baseline');
    this.bestMetric = baseline;
    this.currentMetric = baseline;

    const baselineCommit = exec('git rev-parse --short HEAD');
    const baselineResult: IterationResult = {
      iteration: 0,
      commit: baselineCommit,
      metric: baseline,
      delta: 0,
      guard: this.config.guard ? (this.runGuard() ? 'pass' : 'fail') : '-',
      status: 'baseline',
      description: `initial state — ${this.config.metric} ${baseline}`,
    };
    this.logger.append(baselineResult);
    results.push(baselineResult);
    this.log(`Baseline: ${this.config.metric} = ${baseline}`);

    // Main loop
    const maxIter = this.config.iterations ?? Infinity;
    for (this.iteration = 1; this.iteration <= maxIter; this.iteration++) {
      this.log(`\n━━━ Iteration ${this.iteration}${maxIter < Infinity ? `/${maxIter}` : ''} ━━━`);

      // Phase 1: Review
      const gitLog = exec('git log --oneline -20');
      const recentLog = this.logger.readLast(20);
      const scopeFiles = this.config.scope;
      const consecutiveDiscards = this.logger.consecutiveDiscards();

      // Phase 2-3: Ideate + Modify (delegated to callback)
      const context: ModifyContext = {
        iteration: this.iteration,
        bestMetric: this.bestMetric,
        currentMetric: this.currentMetric,
        recentLog,
        gitLog,
        scopeFiles,
        consecutiveDiscards,
        stuckHint: this.getStuckHint(consecutiveDiscards),
      };

      let description: string | null;
      try {
        description = await this.callbacks.modify(context);
      } catch (err: any) {
        this.log(`  modify error: ${err.message}`);
        const result: IterationResult = {
          iteration: this.iteration,
          commit: '-',
          metric: this.currentMetric,
          delta: 0,
          guard: '-',
          status: 'crash',
          description: `modify crashed: ${err.message?.slice(0, 80)}`,
        };
        this.logger.append(result);
        results.push(result);
        continue;
      }

      if (!description) {
        const result: IterationResult = {
          iteration: this.iteration,
          commit: '-',
          metric: this.currentMetric,
          delta: 0,
          guard: '-',
          status: 'no-op',
          description: 'no changes made',
        };
        this.logger.append(result);
        results.push(result);
        continue;
      }

      // Phase 4: Commit
      this.log(`  commit: ${description}`);
      const commitHash = this.commit(description);
      if (!commitHash) {
        const result: IterationResult = {
          iteration: this.iteration,
          commit: '-',
          metric: this.currentMetric,
          delta: 0,
          guard: '-',
          status: 'no-op',
          description: `no diff after: ${description}`,
        };
        this.logger.append(result);
        results.push(result);
        continue;
      }
      if (commitHash === 'hook-blocked') {
        const result: IterationResult = {
          iteration: this.iteration,
          commit: '-',
          metric: this.currentMetric,
          delta: 0,
          guard: '-',
          status: 'hook-blocked',
          description: `hook rejected: ${description}`,
        };
        this.logger.append(result);
        results.push(result);
        continue;
      }

      // Phase 5: Verify
      const metric = this.runVerify();
      if (metric == null) {
        this.log('  verify crashed — reverting');
        this.safeRevert();
        const result: IterationResult = {
          iteration: this.iteration,
          commit: '-',
          metric: this.currentMetric,
          delta: 0,
          guard: '-',
          status: 'crash',
          description: `verify crashed: ${description}`,
        };
        this.logger.append(result);
        results.push(result);
        continue;
      }

      const improved = this.config.direction === 'higher'
        ? metric > this.bestMetric
        : metric < this.bestMetric;
      const delta = +(metric - this.bestMetric).toFixed(4);
      const absDelta = Math.abs(delta);
      const minDelta = this.config.minDelta ?? 0;

      // Phase 5.5: Guard
      let guardResult: 'pass' | 'fail' | '-' = '-';
      if (this.config.guard && improved && absDelta >= minDelta) {
        guardResult = this.runGuard() ? 'pass' : 'fail';
      }

      // Phase 6: Decide
      let status: IterationStatus;
      if (improved && absDelta >= minDelta && (guardResult !== 'fail')) {
        status = 'keep';
        this.bestMetric = metric;
        this.currentMetric = metric;
        this.log(`  ✓ KEEP — ${this.config.metric}: ${metric} (${delta >= 0 ? '+' : ''}${delta})`);
      } else if (improved && guardResult === 'fail') {
        this.log('  guard failed — reverting');
        this.safeRevert();
        status = 'discard';
        this.log(`  ✗ DISCARD (guard) — ${description}`);
      } else {
        this.safeRevert();
        status = 'discard';
        const reason = absDelta < minDelta ? 'below min delta' : 'no improvement';
        this.log(`  ✗ DISCARD (${reason}) — ${this.config.metric}: ${metric} (${delta >= 0 ? '+' : ''}${delta})`);
      }

      const result: IterationResult = {
        iteration: this.iteration,
        commit: status === 'keep' ? commitHash : '-',
        metric,
        delta,
        guard: guardResult,
        status,
        description,
      };
      this.logger.append(result);
      results.push(result);
    }

    // Summary
    const keeps = results.filter(r => r.status === 'keep' || r.status === 'keep (reworked)');
    const discards = results.filter(r => r.status === 'discard');
    this.log(`\n${'━'.repeat(50)}`);
    this.log(`Done: ${this.iteration - 1} iterations, ${keeps.length} kept, ${discards.length} discarded`);
    this.log(`Final ${this.config.metric}: ${this.bestMetric} (started at ${results[0]?.metric})`);

    return results;
  }
}
