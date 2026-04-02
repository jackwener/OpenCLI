#!/usr/bin/env npx tsx
/**
 * /autoresearch:plan — Interactive configuration wizard.
 *
 * Walks through goal, scope, metric, verify, guard settings
 * and outputs a ready-to-paste run command.
 *
 * Usage:
 *   npx tsx autoresearch/commands/plan.ts
 */

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../presets/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n🔬 AutoResearch — Configuration Wizard\n');

  // Offer presets first
  const presetNames = Object.keys(PRESETS);
  console.log('Available presets:');
  presetNames.forEach((name, i) => {
    console.log(`  [${i + 1}] ${name} — ${PRESETS[name].goal}`);
  });
  console.log(`  [0] Custom config\n`);

  const choice = await ask('Choose preset or 0 for custom: ');
  const idx = parseInt(choice, 10);

  if (idx > 0 && idx <= presetNames.length) {
    const name = presetNames[idx - 1];
    const iterations = await ask('Iterations (empty = unbounded): ');
    const iterFlag = iterations ? ` --iterations ${iterations}` : '';
    console.log(`\n✅ Ready to run:\n`);
    console.log(`  npx tsx autoresearch/commands/run.ts --preset ${name}${iterFlag}\n`);
    rl.close();
    return;
  }

  // Custom config
  const goal = await ask('Goal (what to improve): ');
  const scope = await ask('Scope (file globs, comma-separated): ');
  const metric = await ask('Metric name (e.g. pass_count, coverage): ');
  const direction = await ask('Direction (higher/lower): ') as 'higher' | 'lower';
  const verify = await ask('Verify command (must output a number): ');

  // Dry-run verify
  console.log('\n  Dry-running verify command...');
  try {
    const output = execSync(verify, { cwd: ROOT, timeout: 120_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const { extractMetric } = await import('../config.js');
    const value = extractMetric(output);
    if (value != null) {
      console.log(`  ✓ Verify works — current ${metric}: ${value}`);
    } else {
      console.log(`  ⚠ Verify ran but no number extracted from output:\n    ${output.slice(0, 200)}`);
    }
  } catch (err: any) {
    console.log(`  ✗ Verify failed: ${err.message?.slice(0, 100)}`);
  }

  const guard = await ask('Guard command (optional, press Enter to skip): ');
  const iterations = await ask('Iterations (empty = unbounded): ');

  const parts = ['npx tsx autoresearch/commands/run.ts'];
  parts.push(`--goal "${goal}"`);
  parts.push(`--scope "${scope}"`);
  parts.push(`--metric "${metric}"`);
  parts.push(`--direction ${direction}`);
  parts.push(`--verify "${verify}"`);
  if (guard) parts.push(`--guard "${guard}"`);
  if (iterations) parts.push(`--iterations ${iterations}`);

  console.log(`\n✅ Ready to run:\n`);
  console.log(`  ${parts.join(' \\\n    ')}\n`);

  rl.close();
}

main();
