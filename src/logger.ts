/**
 * Unified logging for opencli.
 *
 * All framework output (warnings, debug info, errors) should go through
 * this module so that verbosity levels are respected consistently.
 */

function isVerbose(): boolean {
  return !!process.env.OPENCLI_VERBOSE;
}

export const log = {
  /** Informational message (always shown) */
  info(msg: string): void {
    process.stderr.write(`ℹ  ${msg}\n`);
  },

  /** Lightweight status line for adapter progress updates */
  status(msg: string): void {
    process.stderr.write(`${msg}\n`);
  },

  /** Positive completion/status line without the heavier info prefix */
  success(msg: string): void {
    process.stderr.write(`${msg}\n`);
  },

  /** Warning (always shown) */
  warn(msg: string): void {
    process.stderr.write(`⚠  ${msg}\n`);
  },

  /** Error (always shown) */
  error(msg: string): void {
    process.stderr.write(`✖  ${msg}\n`);
  },

  /** Verbose output (shown when -v flag or OPENCLI_VERBOSE is set) */
  verbose(msg: string): void {
    if (isVerbose()) {
      process.stderr.write(`[verbose] ${msg}\n`);
    }
  },

  /** Alias for verbose output. */
  debug(msg: string): void {
    this.verbose(msg);
  },

  /** Step-style debug (for pipeline steps, etc.) */
  step(stepNum: number, total: number, op: string, preview: string = ''): void {
    process.stderr.write(`  [${stepNum}/${total}] ${op}${preview}\n`);
  },

  /** Step result summary */
  stepResult(summary: string): void {
    process.stderr.write(`       → ${summary}\n`);
  },
};
