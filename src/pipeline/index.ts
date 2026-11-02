/**
 * Pipeline module: re-exports for backward compatibility.
 */

export { executePipeline, type PipelineContext } from './executor.js';
export { render, evalExpr, resolvePath, normalizeEvaluateSource, type RenderContext } from './template.js';
export type { PaginateResult, PaginationCheckpoint, PaginationValue } from './steps/paginate.js';
