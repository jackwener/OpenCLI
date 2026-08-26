/**
 * Local Fixture Reader  -  shared helper for doctor commands.
 *
 * Scans a local directory for fixture JSON files with safety checks:
 * regular-file-only (no symlinks), configurable pattern, optional size cap.
 * Returns file list + directory-level diagnostic errors.
 *
 * Pure I/O helper. Does NOT parse or validate fixture content.
 *
 * @module reader
 */

import fs from 'node:fs'
import path from 'node:path'

/**
 * Read local JSON fixture files from a directory.
 *
 * @param {object} opts
 * @param {string} opts.dir  -  Directory to scan (resolved via path.resolve)
 * @param {string} [opts.filePattern='.fixture.json']  -  Suffix pattern for fixture files
 * @param {number} [opts.maxBytes]  -  Skip files larger than this (optional)
 * @returns {{ fixtureFiles: string[], dir: string, errors: Array<object> }}
 */
export function readLocalJsonFixtures({ dir, filePattern = '.fixture.json', maxBytes }) {
  const errors = []

  // Guard: empty / missing dir
  if (!dir || typeof dir !== 'string' || dir.trim() === '') {
    errors.push({
      probe: 'fixture-directory',
      status: 'fail',
      count: 0,
      sampleValue: 'no-dir',
      message: 'No fixture directory specified',
    })
    return { fixtureFiles: [], dir: '', errors }
  }

  const resolvedDir = path.resolve(dir.trim())

  if (!fs.existsSync(resolvedDir)) {
    errors.push({
      probe: 'fixture-directory',
      status: 'fail',
      count: 0,
      sampleValue: 'not-found',
      message: 'Fixture directory does not exist: ' + resolvedDir,
    })
    return { fixtureFiles: [], dir: resolvedDir, errors }
  }

  if (!fs.statSync(resolvedDir).isDirectory()) {
    errors.push({
      probe: 'fixture-directory',
      status: 'fail',
      count: 0,
      sampleValue: 'not-a-directory',
      message: 'Path is not a directory: ' + resolvedDir,
    })
    return { fixtureFiles: [], dir: resolvedDir, errors }
  }

  // Read with file type info — skip symlinks
  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true })
  const fixtureFiles = entries
    .filter(function (dirent) {
      // Regular files only — no symlinks, no dirs
      if (!dirent.isFile()) return false
      // Match file pattern
      if (!dirent.name.endsWith(filePattern)) return false
      // Optional size cap
      if (typeof maxBytes === 'number') {
        try {
          const stat = fs.statSync(path.join(resolvedDir, dirent.name))
          if (stat.size > maxBytes) return false
        } catch {
          return false
        }
      }
      return true
    })
    .map(function (dirent) { return path.join(resolvedDir, dirent.name) })
    .sort()

  if (fixtureFiles.length === 0) {
    errors.push({
      probe: 'fixture-count',
      status: 'warn',
      count: 0,
      sampleValue: '0',
      message: 'No ' + filePattern + ' files found in ' + resolvedDir,
    })
  }

  return { fixtureFiles, dir: resolvedDir, errors }
}