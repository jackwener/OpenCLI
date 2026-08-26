/**
 * Download Fixture Set Module  —  fixture intake + schema validation.
 *
 * Owns local fixture directory scanning and DownloadTraceV2 schema validation.
 * Pure I/O at directory level; delegates schema validation to contracts.js.
 *
 * @module loader
 */

import fs from 'node:fs'
import path from 'node:path'
import { validateDownloadTraceV2 } from '../download/contracts.js'

/**
 * Load and validate a directory of .fixture.json download trace files.
 *
 * @param {object} opts
 * @param {string} opts.dir  -  Directory to scan (resolved via path.resolve).
 * @param {string} [opts.filePattern='.fixture.json']  -  File suffix filter.
 * @returns {{
 *   dir: string,
 *   valid: Array<{ file: string, trace: object }>,
 *   invalid: Array<{ file: string, code: string, message: string }>,
 *   stats: { totalFiles: number, validCount: number, invalidCount: number },
 * }}
 */
export function loadDownloadFixtureSet({ dir, filePattern }) {
  filePattern = filePattern || '.fixture.json'

  var resolvedDir = ''
  var errors = []

  // Guard: empty/missing dir
  if (!dir || typeof dir !== 'string' || dir.trim() === '') {
    return {
      dir: '',
      valid: [],
      invalid: [{ file: '', code: 'FIXTURE_DIR_MISSING', message: 'No fixture directory specified' }],
      stats: { totalFiles: 0, validCount: 0, invalidCount: 1 },
    }
  }

  resolvedDir = path.resolve(dir.trim())

  if (!fs.existsSync(resolvedDir)) {
    return {
      dir: resolvedDir,
      valid: [],
      invalid: [{ file: resolvedDir, code: 'FIXTURE_DIR_MISSING', message: 'Fixture directory does not exist: ' + resolvedDir }],
      stats: { totalFiles: 0, validCount: 0, invalidCount: 1 },
    }
  }

  if (!fs.statSync(resolvedDir).isDirectory()) {
    return {
      dir: resolvedDir,
      valid: [],
      invalid: [{ file: resolvedDir, code: 'FIXTURE_DIR_MISSING', message: 'Path is not a directory: ' + resolvedDir }],
      stats: { totalFiles: 0, validCount: 0, invalidCount: 1 },
    }
  }

  // Read files
  var entries
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true })
  } catch (readErr) {
    return {
      dir: resolvedDir,
      valid: [],
      invalid: [{ file: resolvedDir, code: 'FIXTURE_READ_ERROR', message: 'Cannot read directory: ' + (readErr.message || String(readErr)) }],
      stats: { totalFiles: 0, validCount: 0, invalidCount: 1 },
    }
  }

  var fixtureFiles = entries
    .filter(function (d) { return d.isFile() && d.name.endsWith(filePattern) })
    .map(function (d) { return path.join(resolvedDir, d.name) })
    .sort()

  var valid = []
  var invalid = []

  for (var i = 0; i < fixtureFiles.length; i++) {
    var fp = fixtureFiles[i]
    var baseName = path.basename(fp)

    // Read file
    var raw
    try {
      raw = fs.readFileSync(fp, 'utf-8')
    } catch (readErr) {
      invalid.push({ file: baseName, code: 'FIXTURE_READ_ERROR', message: 'Cannot read file: ' + (readErr.message || String(readErr)) })
      continue
    }

    // Parse JSON
    var parsed
    try {
      parsed = JSON.parse(raw)
    } catch (parseErr) {
      invalid.push({ file: baseName, code: 'FIXTURE_PARSE_ERROR', message: parseErr.message || 'unparseable JSON' })
      continue
    }

    // Validate schema
    var schemaResult = validateDownloadTraceV2(parsed)
    if (!schemaResult.valid) {
      invalid.push({ file: baseName, code: 'FIXTURE_SCHEMA_REJECT', message: schemaResult.error })
      continue
    }

    valid.push({ file: baseName, trace: parsed })
  }

  return {
    dir: resolvedDir,
    valid: valid,
    invalid: invalid,
    stats: {
      totalFiles: fixtureFiles.length,
      validCount: valid.length,
      invalidCount: invalid.length,
    },
  }
}