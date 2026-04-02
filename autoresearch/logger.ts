/**
 * AutoResearch TSV Logger — append-only results log with metadata header.
 */

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import type { AutoResearchConfig, IterationResult } from './config.js';

const COLUMNS = ['iteration', 'commit', 'metric', 'delta', 'guard', 'status', 'description'];

export class Logger {
  constructor(private path: string) {}

  /** Create the TSV file with metadata header */
  init(config: AutoResearchConfig): void {
    const header = [
      `# metric_direction: ${config.direction === 'higher' ? 'higher_is_better' : 'lower_is_better'}`,
      `# goal: ${config.goal}`,
      `# scope: ${config.scope.join(', ')}`,
      `# verify: ${config.verify}`,
      config.guard ? `# guard: ${config.guard}` : null,
      COLUMNS.join('\t'),
    ].filter(Boolean).join('\n');
    writeFileSync(this.path, header + '\n', 'utf-8');
  }

  /** Append one iteration result */
  append(result: IterationResult): void {
    const row = [
      result.iteration,
      result.commit,
      result.metric,
      result.delta >= 0 ? `+${result.delta}` : result.delta,
      result.guard,
      result.status,
      result.description,
    ].join('\t');
    appendFileSync(this.path, row + '\n', 'utf-8');
  }

  /** Read last N entries for pattern recognition */
  readLast(n: number): IterationResult[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, 'utf-8').split('\n')
      .filter(l => l && !l.startsWith('#') && !l.startsWith('iteration'));
    return lines.slice(-n).map(line => {
      const [iteration, commit, metric, delta, guard, status, ...desc] = line.split('\t');
      return {
        iteration: parseInt(iteration, 10),
        commit,
        metric: parseFloat(metric),
        delta: parseFloat(delta),
        guard: guard as 'pass' | 'fail' | '-',
        status: status as IterationResult['status'],
        description: desc.join('\t'),
      };
    });
  }

  /** Count consecutive discards from the end */
  consecutiveDiscards(): number {
    const entries = this.readLast(20);
    let count = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].status === 'discard') count++;
      else break;
    }
    return count;
  }
}
