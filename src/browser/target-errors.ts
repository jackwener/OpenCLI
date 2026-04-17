/**
 * Structured error types for the target resolution system.
 *
 * Every browser action (click, type, select, get) that targets a DOM element
 * goes through the unified resolver. When resolution fails, one of these
 * structured errors is thrown so that AI agents and adapter authors get
 * actionable diagnostics instead of a generic "Element not found".
 */

export type TargetErrorCode = 'not_found' | 'ambiguous' | 'stale_ref';

export interface TargetErrorInfo {
  code: TargetErrorCode;
  message: string;
  hint: string;
  candidates?: string[];
}

export class TargetError extends Error {
  readonly code: TargetErrorCode;
  readonly hint: string;
  readonly candidates?: string[];

  constructor(info: TargetErrorInfo) {
    super(info.message);
    this.name = 'TargetError';
    this.code = info.code;
    this.hint = info.hint;
    this.candidates = info.candidates;
  }

  /** Serialize for structured output to AI agents */
  toJSON(): TargetErrorInfo {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      ...(this.candidates && { candidates: this.candidates }),
    };
  }
}
