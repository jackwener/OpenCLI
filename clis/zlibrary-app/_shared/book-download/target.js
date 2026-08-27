/**
 * Download Target Policy Module for Z-Library Desktop.
 *
 * Consolidates output path containment, extension validation, and
 * filename safety logic duplicated across download.js and
 * booklist-download.js.
 *
 * All functions are pure (no side effects) except assertions that
 * throw ArgumentError on policy violations.
 *
 * @module download-target
 */

import { ArgumentError } from '@jackwener/opencli/errors'
import path from 'node:path'
import { DOWNLOAD_FORMATS } from './contracts.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid download extensions (single source from download-contracts.js) */
const VALID_FORMATS = DOWNLOAD_FORMATS

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate download CLI arguments from kwargs.
 *
 * @param {object} kwargs - Raw CLI args
 * @param {object} options
 * @param {string} options.commandName - Command name for error messages
 * @param {string} [options.defaultOutput='./downloads'] - Default output dir
 * @param {boolean} [options.requireExtension=true] - Whether extension is required
 * @returns {{ outputDir: string, extension: string|null }}
 * @throws {ArgumentError}
 */
export function parseDownloadTargetArgs(kwargs, options) {
  const commandName = options.commandName
  const defaultOutput = options.defaultOutput || './downloads'
  const requireExtension = options.requireExtension !== false

  // Parse extension
  let extension = null
  if (requireExtension || (kwargs.extension != null && kwargs.extension !== '')) {
    extension = String(kwargs.extension || '').toLowerCase().trim()
    if (!extension || !VALID_FORMATS.includes(extension)) {
      throw new ArgumentError(
        commandName + ': --extension must be one of: ' + VALID_FORMATS.join(', '),
        'Supported formats: epub, pdf, mobi, azw3'
      )
    }
  }

  // Parse output directory
  const outputDir = String(kwargs.output || defaultOutput).trim()
  const resolvedDir = path.resolve(outputDir)

  return { outputDir: resolvedDir, extension }
}

// ---------------------------------------------------------------------------
// Path security assertions
// ---------------------------------------------------------------------------

/**
 * Assert that a candidate path is inside (or equal to) a base directory.
 * Uses path.relative to reject prefix-bypass attacks like /cwd2.
 *
 * @param {string} baseDir - Resolved base directory
 * @param {string} candidatePath - Resolved candidate path
 * @throws {ArgumentError}
 */
export function assertPathInsideDirectory(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir)
  const resolvedCandidate = path.resolve(candidatePath)
  const relativePath = path.relative(resolvedBase, resolvedCandidate)
  // Check for path traversal: relative path starting with `..` as a
  // component separator (../ or ..\ or exact `..`), not as part of a
  // filename (e.g. `.._evil` is safe, `../evil` is not).
  if (relativePath === '..' || relativePath.startsWith('../') || relativePath.startsWith('..\\') || path.isAbsolute(relativePath)) {
    throw new ArgumentError(
      'Path escapes the allowed directory',
      'Expected path under: ' + resolvedBase
    )
  }
}

/**
 * Reject a filename that contains path traversal characters.
 *
 * @param {string} filename - The filename to check (e.g. '../escape.txt')
 * @throws {ArgumentError}
 */
export function assertSafeFilename(filename) {
  // Catch actual path traversal patterns:
  // - ../ or ..\ (directory escape)
  // - Leading .. as a complete component (e.g. ..file is safe, ../file is not)
  // - Backslashes and control characters
  // NOTE: bare ".." substring (e.g. .._evil) is NOT a path traversal
  // and must be allowed for sanitised book IDs.
  if (/(?:^|\/|\\|:)\.\.(?:\/|\\|$)|[/\\]|[\x00-\x1f\x7f]/.test(filename)) {
    throw new ArgumentError(
      'Filename contains path traversal characters: ' + filename,
      'Use only alphanumeric characters, underscores, hyphens, and spaces.'
    )
  }
}

// ---------------------------------------------------------------------------
// Path composition
// ---------------------------------------------------------------------------

/**
 * Safely build an output path from directory and filename with
 * defense-in-depth path containment validation.
 *
 * @param {string} outputDir - Resolved output directory
 * @param {string} filename - Safe filename (extension included)
 * @returns {string} - Full output path
 * @throws {ArgumentError} - If filename escapes the directory
 */
export function buildOutputPath(outputDir, filename) {
  assertSafeFilename(filename)
  const fullPath = path.join(outputDir, filename)
  assertPathInsideDirectory(outputDir, fullPath)
  return fullPath
}

// ---------------------------------------------------------------------------
// Extension validation
// ---------------------------------------------------------------------------

/**
 * Validate a download extension against the allowed list.
 *
 * @param {string|null|undefined} extension - The extension
 * @returns {string} - The validated, lowercased extension
 * @throws {ArgumentError}
 */
export function validateDownloadExtension(extension) {
  const ext = String(extension || '').toLowerCase().trim()
  if (!ext || !VALID_FORMATS.includes(ext)) {
    throw new ArgumentError(
      '--extension must be one of: ' + VALID_FORMATS.join(', '),
      'Supported formats: epub, pdf, mobi, azw3'
    )
  }
  return ext
}
