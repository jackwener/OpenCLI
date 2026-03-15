/**
 * YAML pipeline executor — re-exports from modular pipeline system.
 *
 * This file exists for backward compatibility. All logic has been
 * refactored into src/pipeline/ with modular step handlers.
 */

export { executePipeline, type PipelineContext } from './pipeline/index.js';
