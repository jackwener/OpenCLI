export type ObservationStream = 'action' | 'network' | 'console' | 'screenshot' | 'state' | 'error';

export interface ObservationScope {
  contextId?: string;
  session: string;
  target?: string;
  site?: string;
  command?: string;
  adapterSourcePath?: string;
}

interface BaseObservationEvent {
  id: string;
  ts: number;
  stream: ObservationStream;
}

export interface ActionObservationEvent extends BaseObservationEvent {
  stream: 'action';
  name: string;
  phase?: 'start' | 'end' | 'error';
  data?: Record<string, unknown>;
}

export interface NetworkObservationEvent extends BaseObservationEvent {
  stream: 'network';
  url: string;
  method?: string;
  status?: number;
  contentType?: string;
  size?: number;
  requestHeaders?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface ConsoleObservationEvent extends BaseObservationEvent {
  stream: 'console';
  level: string;
  text: string;
  source?: string;
}

export interface ScreenshotObservationEvent extends BaseObservationEvent {
  stream: 'screenshot';
  format: 'png' | 'jpeg';
  data: string;
  label?: string;
}

export interface StateObservationEvent extends BaseObservationEvent {
  stream: 'state';
  url?: string | null;
  target?: string;
  snapshot?: unknown;
  label?: string;
}

export interface ErrorObservationEvent extends BaseObservationEvent {
  stream: 'error';
  code?: string;
  message: string;
  stack?: string;
  hint?: string;
}

export type ObservationEvent =
  | ActionObservationEvent
  | NetworkObservationEvent
  | ConsoleObservationEvent
  | ScreenshotObservationEvent
  | StateObservationEvent
  | ErrorObservationEvent;

export type ObservationEventInput =
  ObservationEvent extends infer T
    ? T extends ObservationEvent
      ? Omit<T, 'id' | 'ts'> & Partial<Pick<T, 'id' | 'ts'>>
      : never
    : never;

export interface ObservationExportResult {
  traceId: string;
  dir: string;
  summaryPath: string;
  receiptPath: string;
  receipt: ObservationTraceReceipt;
}

export type ObservationExportStatus = 'success' | 'failure';

export interface ObservationTraceReceipt {
  schemaVersion: 1;
  opencliVersion: string;
  traceId: string;
  traceDir: string;
  summaryPath: string;
  receiptPath: string;
  status: ObservationExportStatus;
  createdAt: string;
  /** Advisory only; actual deletion is governed by current trace retention budgets. */
  expiresAt?: string;
  scope?: ObservationScope;
  error?: {
    name?: string;
    code?: string;
    message: string;
    hint?: string;
    exitCode?: number;
  };
}
