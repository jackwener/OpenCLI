/**
 * Fixture module — barrel export for all fixture utilities.
 *
 * Import from this module for common fixture operations:
 * ```js
 * import { writeJsonAtomic, ApiCallRecorder, DownloadFixtureRecorder } from './_shared/fixture/index.js'
 * ```
 *
 * @module fixture
 */

// Output primitives
export { writeJsonAtomic, formatFixtureTimestamp, sanitiseFixtureId } from './output.js'

// API recorder
export { ApiCallRecorder } from './api-recorder.js'

// Manage mutation recorder
export { ManageMutationTraceRecorder, buildManageFixtureFilename } from './manage-recorder.js'

// Download trace recorder
export { DownloadFixtureRecorder, buildFixtureFilename } from './download-recorder.js'

// URL normalizer
export { normalizeFixtureUrls } from './url-normalizer.js'
