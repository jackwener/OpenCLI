// @ts-check

/**
 * Download workflow for zlibrary-app.
 *
 * Orchestrates the artifact pipeline: validate URL -> transport.download ->
 * validate artifact -> ingest -> return result. CLI loop owns book iteration
 * and retry; workflow owns the artifact pipeline.
 *
 * @module _shared/book-download/workflow
 */

import fs from 'node:fs'
import path from 'node:path'

import { validateDownloadRequest, buildDownloadArtifact, validateDownloadArtifact, ingestDownloadArtifact, renderFinalFilename } from './contracts.js'
import { saveCompletedManifestEntry, renderFilenameTemplate, normalizeOutputKeys } from '../infra/manifest-helpers.js'
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors'

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BookInfo
 * @property {string} bookId
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [language]
 * @property {string} [extension]
 * @property {string} [md5]
 * @property {string} [url]
 * @property {string} [formatQualityRating]
 */

/**
 * @typedef {Object} PageContext
 * @property {string} origin  -  page origin (e.g. https://1lib.sk)
 * @property {string} referer  -  same-origin referer URL
 */

/**
 * @typedef {Object} DownloadWorkflowResult
 * @property {string} filename
 * @property {string} outputPath
 * @property {number} fileSize
 * @property {string} md5
 * @property {string} [cdnUrl]
 * @property {string} [cdnMd5]
 * @property {boolean} [cdnMd5Verified]
 */

/**
 * @typedef {Object} ManifestOptions
 * @property {string} manifestPath
 * @property {string} outputDir
 * @property {function(string, object): void} [saveEntry]
 */

// ---------------------------------------------------------------------------
// buildDownloadRequestFromBook
// ---------------------------------------------------------------------------

/**
 * Construct a validated DownloadRequest from book metadata and page context.
 *
 * @param {BookInfo} book  -  book metadata from booklist API
 * @param {PageContext} pageContext  -  current page origin + referer
 * @param {object} [opts]
 * @param {string} [opts.outputDir] - output directory (default: ./downloads)
 * @param {number} [opts.timeoutMs=300000]
 * @param {boolean} [opts.fixture=false]
 * @returns {import('./contracts.js').DownloadRequest}
 * @throws {import('@jackwener/opencli/errors').ArgumentError}
 */
export function buildDownloadRequestFromBook(book, pageContext, opts = {}) {
  const { bookId, url, extension } = book
  const { origin, referer } = pageContext

  if (!bookId) throw new ArgumentError('bookId is required')
  if (!origin) throw new ArgumentError('origin is required')

  const format = (extension || 'epub').toLowerCase()
  const outputDir = opts.outputDir || './downloads'

  return {
    bookId: String(bookId),
    urlRelative: url || `/dl/${bookId}`,
    origin,
    referer,
    format,
    outputDir,
    timeoutMs: opts.timeoutMs ?? 300000,
    fixture: opts.fixture ?? false,
  }
}

// ---------------------------------------------------------------------------
// runDownloadWorkflow
// ---------------------------------------------------------------------------

/**
 * Run the full download workflow: validate URL -> transport.download ->
 * validate artifact (content sniff, MD5 verification) -> ingest.
 *
 * @param {function(import('./contracts.js').DownloadRequest, object): Promise<import('./contracts.js').DownloadArtifact>} transport
 * @param {import('./contracts.js').DownloadRequest} request
 * @param {object} [opts]
 * @param {boolean} [opts.verifyDownload=true] - verify file integrity
 * @returns {Promise<DownloadWorkflowResult>}
 * @throws {CommandExecutionError} on validation failure, block page, MD5 mismatch
 */
export async function runDownloadWorkflow(transport, request, opts = {}) {
  const verifyDownload = opts.verifyDownload !== false

  // Phase 1: Transport download
  const artifact = await transport(request, {
    tempPath: undefined, // let transport decide temp path
  })

  // Phase 2: Validate artifact
  const { tempPath } = artifact
  if (!tempPath) {
    throw new CommandExecutionError('Download transport returned no tempPath')
  }

  // Phase 3: Validate artifact structure
  const artifactValidation = validateDownloadArtifact(artifact, request)
  if (!artifactValidation.valid) {
    throw new CommandExecutionError('Invalid artifact: ' + artifactValidation.error)
  }

  // Phase 4: Ingest via shared contracts (sniff → MD5 → rename → manifest)
  // Use safe {bookId}.{format} template for ingest; full template rendering
  // happens in Phase 7 after computed MD5 is available.
  const ingestRequest = {
    ...request,
    filenameTemplate: '{bookId}.{format}',
  }
  const ingestResult = ingestDownloadArtifact(artifact, ingestRequest, {
    rejectBlockPage: true,
    verifyMd5: false, // MD5 vs request.metadata.md5 checked separately below
  })

  // Phase 5: Handle block page rejection
  const finalPathValid = String(ingestResult.finalPath || tempPath)
  if (ingestResult.status === 'rejected') {
    if (ingestResult.reason === 'block_page') {
      throw new CommandExecutionError(
        `Download returned an HTML page instead of a file for ${request.bookId}`
      )
    }
    throw new CommandExecutionError(
      'Download ingest rejected: ' + (ingestResult.reason || 'unknown')
    )
  }

  // Phase 6: MD5 verification against request.metadata.md5 (not CDN MD5)
  const md5 = ingestResult.md5 || artifact.md5 || ''
  if (verifyDownload && request.metadata?.md5 && md5 && md5 !== request.metadata.md5) {
    // ingestDownloadArtifact already renamed; unlink on mismatch
    try { if (finalPathValid) fs.unlinkSync(finalPathValid) } catch { /**/ }
    throw new CommandExecutionError(
      `Downloaded file MD5 mismatch: expected ${request.metadata.md5}, got ${md5}`
    )
  }

  // Phase 7: Final filename rendering with full template + computed MD5
  // ingestDownloadArtifact used {bookId}.{format}; now render the real template.
  const ingestPath = ingestResult.finalPath || tempPath
  const template = request.filenameTemplate || '{bookId}.{format}'
  const values = normalizeOutputKeys({
    ...(request.metadata || {}),
    id: String(request.bookId),
    bookId: String(request.bookId),
    md5: md5 || '',
    extension: request.format,
    format: request.format,
  })
  const finalFilename = renderFilenameTemplate(template, values)
  let finalPath = path.resolve(path.dirname(ingestPath), finalFilename)
  if (finalPath !== ingestPath) {
    try {
      fs.renameSync(ingestPath, finalPath)
    } catch (renameErr) {
      // Rename failed (EBUSY/EPERM/permission) — use ingest path instead
      console.warn('[download-workflow] renameSync failed', {
        from: ingestPath,
        to: finalPath,
        error: renameErr instanceof Error ? renameErr.message : String(renameErr),
      })
      // finalPath becomes the ingest path since rename didn't happen
      // This ensures we don't report a path that doesn't exist
      finalPath = ingestPath
    }
  }

  return {
    filename: finalFilename,
    outputPath: finalPath,
    fileSize: ingestResult.sizeBytes || artifact.sizeBytes || 0,
    md5: md5 || '',
    cdnUrl: artifact.source?.finalUrl || '',
    cdnMd5: artifact.source?.cdnMd5 || '',
    cdnMd5Verified: md5 ? md5 === artifact.source?.cdnMd5 : false,
  }
}

// ---------------------------------------------------------------------------
// recordCompletedDownload
// ---------------------------------------------------------------------------

/**
 * Record a completed download in the manifest.
 *
 * @param {DownloadWorkflowResult} result
 * @param {ManifestOptions} manifestOpts
 * @param {Record<string, string>} [bookMeta] - additional book metadata for manifest entry
 */
export function recordCompletedDownload(result, manifestOpts, bookMeta = {}) {
  const { manifestPath, outputDir } = manifestOpts
  const { filename, fileSize, md5 } = result

  saveCompletedManifestEntry(manifestPath, {
    book_id: bookMeta.bookId || '',
    title: bookMeta.title || '',
    author: bookMeta.author || '',
    language: bookMeta.language || '',
    extension: (filename.split('.').pop() || '').toLowerCase(),
    filename,
    file_size: fileSize,
    md5: md5 || null,
  })
}
