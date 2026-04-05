/**
 * Unified logging for opencli.
 *
 * All framework output (warnings, debug info, errors) should go through
 * this module so that verbosity levels are respected consistently.
 */

import chalk from 'chalk';

function isVerbose(): boolean {
  return !!process.env.OPENCLI_VERBOSE;
}

function isDebug(): boolean {
  return !!process.env.DEBUG?.includes('opencli');
}

export const log = {
  /** Informational message (always shown) */
  info(msg: string): void {
    process.stderr.write(`${chalk.blue('ℹ')}  ${msg}\n`);
  },

  /** Lightweight status line for adapter progress updates */
  status(msg: string): void {
    process.stderr.write(`${chalk.dim(msg)}\n`);
  },

  /** Positive completion/status line without the heavier info prefix */
  success(msg: string): void {
    process.stderr.write(`${chalk.green(msg)}\n`);
  },

  /** Warning (always shown) */
  warn(msg: string): void {
    process.stderr.write(`${chalk.yellow('⚠')}  ${msg}\n`);
  },

  /** Error (always shown) */
  error(msg: string): void {
    process.stderr.write(`${chalk.red('✖')}  ${msg}\n`);
  },

  /** Verbose output (only when OPENCLI_VERBOSE is set or -v flag) */
  verbose(msg: string): void {
    if (isVerbose()) {
      process.stderr.write(`${chalk.dim('[verbose]')} ${msg}\n`);
    }
  },

  /** Debug output (only when DEBUG includes 'opencli') */
  debug(msg: string): void {
    if (isDebug()) {
      process.stderr.write(`${chalk.dim('[debug]')} ${msg}\n`);
    }
  },

  /** Step-style debug (for pipeline steps, etc.) */
  step(stepNum: number, total: number, op: string, preview: string = ''): void {
    process.stderr.write(`  ${chalk.dim(`[${stepNum}/${total}]`)} ${chalk.bold.cyan(op)}${preview}\n`);
  },

  /** Step result summary */
  stepResult(summary: string): void {
    process.stderr.write(`       ${chalk.dim(`→ ${summary}`)}\n`);
  },
};
