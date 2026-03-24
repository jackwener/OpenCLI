/**
 * Record module — capture API calls from a live browser session.
 *
 * Re-exports all public symbols for backward-compatible API.
 */

export type { RecordedRequest, RecordResult, RecordOptions } from './types.js';
export { generateFullCaptureInterceptorJs, generateReadRecordedJs } from './interceptor.js';
export { urlToPattern, detectAuthIndicators, findArrayPath, inferCapabilityName, inferStrategy, scoreRequest } from './analysis.js';
export { buildRecordedYaml } from './generator.js';
export { recordSession, renderRecordSummary } from './session.js';
