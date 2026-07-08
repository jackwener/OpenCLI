/**
 * Structured error types for the target resolution system.
 *
 * Every browser action (click, type, select, get) that targets a DOM element
 * goes through the unified resolver. When resolution fails, one of these
 * structured errors is thrown so that AI agents and adapter authors get
 * actionable diagnostics instead of a generic "Element not found".
 *
 * Numeric-ref codes (from snapshot indices):
 *   - not_found: the ref no longer exists in the DOM
 *   - stale_ref: the ref still exists but points to a different element
 *
 * CSS-selector codes (from `--selector <css>` entrypoints):
 *   - invalid_selector:       selector syntax rejected by querySelectorAll
 *   - selector_not_found:     0 matches
 *   - selector_ambiguous:     >1 matches for a write op without --nth
 *   - selector_nth_out_of_range: --nth beyond matches_n
 *   - not_editable:           target exists but cannot accept text input
 *   - not_checkable:          target exists but cannot be checked/unchecked
 *   - not_file_input:         target exists but is not a usable file input
 */

export type TargetErrorCode =
  | 'not_found'
  | 'stale_ref'
  | 'invalid_selector'
  | 'selector_not_found'
  | 'selector_ambiguous'
  | 'selector_nth_out_of_range'
  | 'not_editable'
  | 'not_checkable'
  | 'not_file_input';

export interface TargetErrorInfo {
  code: TargetErrorCode;
  message: string;
  hint: string;
  candidates?: string[];
  /** CSS-path match count, when the error was raised mid-resolution */
  matches_n?: number;
}

export class TargetError extends Error {
  readonly code: TargetErrorCode;
  readonly hint: string;
  readonly candidates?: string[];
  readonly matches_n?: number;

  constructor(info: TargetErrorInfo) {
    super(info.message);
    this.name = 'TargetError';
    this.code = info.code;
    this.hint = info.hint;
    this.candidates = info.candidates;
    this.matches_n = info.matches_n;
  }

  /** Serialize for structured output to AI agents */
  toJSON(): TargetErrorInfo {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      ...(this.candidates && { candidates: this.candidates }),
      ...(this.matches_n !== undefined && { matches_n: this.matches_n }),
    };
  }
}
