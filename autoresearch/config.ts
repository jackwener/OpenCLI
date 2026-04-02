/**
 * AutoResearch Configuration — type definitions and CLI parsing.
 *
 * Based on Karpathy's autoresearch: constraint + mechanical metric + unbounded loop.
 */

export interface AutoResearchConfig {
  /** Plain-language goal, e.g. "Increase operate pass rate to 59/59" */
  goal: string;
  /** Glob patterns for files the agent can modify */
  scope: string[];
  /** What the metric measures, e.g. "pass_count" */
  metric: string;
  /** Whether improvement means the number goes up or down */
  direction: 'higher' | 'lower';
  /** Shell command that outputs a number (the metric value) */
  verify: string;
  /** Optional guard command — must pass for a keep decision */
  guard?: string;
  /** Max iterations (undefined = unbounded) */
  iterations?: number;
  /** Minimum delta to count as real improvement (noise filter) */
  minDelta?: number;
}

export type IterationStatus =
  | 'baseline'
  | 'keep'
  | 'keep (reworked)'
  | 'discard'
  | 'crash'
  | 'no-op'
  | 'hook-blocked';

export interface IterationResult {
  iteration: number;
  commit: string;
  metric: number;
  delta: number;
  guard: 'pass' | 'fail' | '-';
  status: IterationStatus;
  description: string;
}

/** Parse CLI args into a partial config (missing fields filled by preset or prompts) */
export function parseArgs(argv: string[]): Partial<AutoResearchConfig> & { preset?: string; task?: string } {
  const config: Partial<AutoResearchConfig> & { preset?: string; task?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--preset': config.preset = next; i++; break;
      case '--goal': config.goal = next; i++; break;
      case '--scope': config.scope = next?.split(','); i++; break;
      case '--metric': config.metric = next; i++; break;
      case '--direction': config.direction = next as 'higher' | 'lower'; i++; break;
      case '--verify': config.verify = next; i++; break;
      case '--guard': config.guard = next; i++; break;
      case '--iterations': config.iterations = parseInt(next, 10); i++; break;
      case '--min-delta': config.minDelta = parseFloat(next); i++; break;
      case '--task': config.task = next; i++; break;
    }
  }
  return config;
}

/** Extract a number from command output using common patterns */
export function extractMetric(output: string): number | null {
  // Try: last line that looks like a number
  const lines = output.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // Match standalone numbers: "56", "95.2", "SCORE=56/59" → 56
    const scoreMatch = line.match(/SCORE[=:]\s*(\d+)/i);
    if (scoreMatch) return parseFloat(scoreMatch[1]);
    const numMatch = line.match(/^[\d.]+$/);
    if (numMatch) return parseFloat(numMatch[0]);
  }
  // Fallback: first number in output
  const fallback = output.match(/(\d+(?:\.\d+)?)/);
  return fallback ? parseFloat(fallback[1]) : null;
}
