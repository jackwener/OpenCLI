/**
 * Shared types for the record module.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  status: number | null;
  contentType: string;
  body: unknown;
  capturedAt: number;
}

export interface RecordResult {
  site: string;
  url: string;
  requests: RecordedRequest[];
  outDir: string;
  candidateCount: number;
  candidates: Array<{ name: string; path: string; strategy: string }>;
}

export interface RecordOptions {
  BrowserFactory: new () => { connect(o?: unknown): Promise<import('../types.js').IPage>; close(): Promise<void> };
  site?: string;
  url: string;
  outDir?: string;
  pollMs?: number;
  timeoutMs?: number;
}
