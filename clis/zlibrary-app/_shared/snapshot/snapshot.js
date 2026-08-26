/**
 * Snapshot Module  -  save, load, compare, and probe-detect behavior snapshots.
 *
 * A snapshot records Z-Library's observable API/DOM behavior at a point in
 * time as a JSON file. The snapshot IS the spec  -  drift is detected by
 * comparing current probe results against the recorded snapshot.
 *
 * Framework helpers (P9 snapshot contract):
 *   saveSnapshotOrWarn(results, fixturePath, meta) → boolean
 *   printSecurityWarning()
 *   classifyProbeDiff(diff, probeName, currentEntry, recordedEntry) → ProbeDiffRecord
 *   detectProbeDrift(currentEntries, fixturePath, adapter) → boolean
 *   adaptProbeEntry(entry, mapping) → ProbeEntry
 *
 * See opencli-doctor-diagnostics.md P9–P10 for full contract.
 *
 * @module _shared/snapshot
 */

import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// saveSnapshot
// ---------------------------------------------------------------------------

/**
 * Save a snapshot to disk (atomic write).
 *
 * Shared fixture contract: { results: { [probeName]: probePayload } }.
 *
 * @param {object} results  - Pass-only probe results, keyed by probeName.
 * @param {string} fixturePath - Full path to the fixture file.
 * @param {object} _metaIgnored - Kept for backward-compatible call sites.
 * @returns {{ success: boolean, error?: string }}
 *   - success: true if written OK
 *   - error: string description if write failed
 */
export function saveSnapshot(results, fixturePath, _metaIgnored) {
  try {
    const snapshot = {
      results: results || {},
    }

    const dir = path.dirname(fixturePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(fixturePath, JSON.stringify(snapshot, null, 2), 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || String(err) }
  }
}

// ---------------------------------------------------------------------------
// loadSnapshot
// ---------------------------------------------------------------------------

/**
 * Load a snapshot from disk.
 *
 * @param {string} fixturePath - Full path to the fixture file.
 * @returns {object|null} Parsed snapshot object, or null if file not found
 *   or JSON corrupt.
 */
export function loadSnapshot(fixturePath) {
  try {
    if (!fs.existsSync(fixturePath)) return null
    const raw = fs.readFileSync(fixturePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// compareShape
// ---------------------------------------------------------------------------

/**
 * Parse a shape string into a Set of keys.
 * Handles: "array<id,name>", "list<id,name>", "id,name,product" (flat object)
 *
 * @param {string} shapeStr
 * @returns {Set<string>}
 */
function parseShapeKeys(shapeStr) {
  const str = String(shapeStr || '').trim()
  if (!str) return new Set()

  // array<...> or list<...>
  const match = str.match(/^(?:array|list)<(.+)>$/)
  if (match) {
    return new Set(match[1].split(',').map(k => k.trim()).filter(Boolean))
  }

  // Flat object: "id,name,product" or "(empty)"
  if (str === '(empty)') return new Set()
  return new Set(str.split(',').map(k => k.trim()).filter(Boolean))
}

/**
 * Compare a recorded fixture entry against a current probe result.
 *
 * Compares: shape string (extracted keys), endpoint URL, HTTP status.
 * This is a STRUCTURAL comparison, not deep equality of the data payload.
 *
 * @param {object} recorded - Fixture entry for this probe.
 * @param {object} current  - Current probe result for this probe.
 * @returns {{
 *   isIdentical: boolean,
 *   addedKeys: string[],
 *   missingKeys: string[],
 *   endpointChanged: boolean,
 *   httpStatusChanged: boolean,
 * }}
 */
export function compareShape(recorded, current) {
  const recordedKeys = parseShapeKeys(recorded.shape)
  const currentKeys = parseShapeKeys(current.shape)

  const missingKeys = []
  const addedKeys = []

  for (const key of recordedKeys) {
    if (!currentKeys.has(key)) missingKeys.push(key)
  }
  for (const key of currentKeys) {
    if (!recordedKeys.has(key)) addedKeys.push(key)
  }

  const endpointChanged = String(recorded.endpoint) !== String(current.endpoint)
  const httpStatusChanged = Number(recorded.httpStatus ?? -1) !== Number(current.httpStatus ?? -1)
  const shapeChanged = missingKeys.length > 0 || addedKeys.length > 0
  const isIdentical = !shapeChanged && !endpointChanged && !httpStatusChanged

  return {
    isIdentical,
    addedKeys,
    missingKeys,
    endpointChanged,
    httpStatusChanged,
  }
}

// ---------------------------------------------------------------------------
// deriveShapeFromData
// ---------------------------------------------------------------------------

/**
 * Derive a shape string from raw response data.
 * Matches the Phase 1 analysis logic but operates on stored fixture data.
 *
 * @param {*} data - Raw API response (parsed JSON)
 * @returns {string} Shape descriptor like "success,list<id,title>" or "array<id,name>"
 */
export function deriveShapeFromData(data) {
  if (!data || typeof data !== 'object') return ''

  // Detect Z-Library Desktop API wrapper: { success, list: [...] }
  if (!Array.isArray(data) && 'success' in data && 'list' in data && Array.isArray(data.list)) {
    if (data.list.length === 0) return 'list<empty>'
    return 'list<' + Object.keys(data.list[0]).join(',') + '>'
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return 'array<empty>'
    return 'array<' + Object.keys(data[0]).join(',') + '>'
  }
  // Flat object  -  show top-level keys
  const keys = Object.keys(data).filter(function (k) { return k !== 'error' && k !== '_httpStatus' })
  return keys.join(',') || '(empty)'
}

// ---------------------------------------------------------------------------
// adaptProbeEntry
// ---------------------------------------------------------------------------

/**
 * Map a physical fixture entry to a normalized ProbeEntry shape.
 *
 * Convenience helper  -  doctors may inline this mapping if simpler.
 *
 * @param {object} entry - Physical fixture entry (e.g. from fixture.results[probeName]).
 * @param {object} mapping - Field mapping config.
 * @param {string} mapping.probeName - Stable probe name.
 * @param {string} mapping.sourceKind - 'api' | 'dom-list' | 'dom-detail' | 'private-dom'.
 * @param {string} mapping.locationKey - Source field name for location (e.g. 'endpoint', 'selector', 'path').
 * @param {string} [mapping.httpStatusKey='httpStatus'] - Source field for HTTP status.
 * @param {string} mapping.shapeKey - Source field for shape string.
 * @param {string} mapping.observedCountKey - Source field for observed count.
 * @param {string} mapping.payloadKey - Source field for raw payload.
 * @returns {object} Normalized ProbeEntry.
 */
export function adaptProbeEntry(entry, mapping) {
  return {
    probeName: mapping.probeName,
    sourceKind: mapping.sourceKind,
    location: String(entry[mapping.locationKey] || ''),
    httpStatus: Number(entry[mapping.httpStatusKey || 'httpStatus'] ?? 200),
    shape: String(entry[mapping.shapeKey] || ''),
    observedCount: String(entry[mapping.observedCountKey] || ''),
    payload: entry[mapping.payloadKey] || {},
  }
}

// ---------------------------------------------------------------------------
// classifyProbeDiff
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ProbeDiffRecord
 * @property {string} probe - 'fixture-' + probeName
 * @property {'warn'|'fail'} severity
 * @property {string} message
 * @property {object} diffDetail
 * @property {string[]} diffDetail.addedKeys
 * @property {string[]} diffDetail.missingKeys
 * @property {boolean} diffDetail.endpointChanged
 * @property {boolean} diffDetail.httpStatusChanged
 */

/**
 * Classify a compareShape() result into a probe diff record.
 *
 * Pure classification  -  no I/O, no row formatting.
 *
 * Severity rules:
 *   - missing shape keys → fail
 *   - location changed  → fail
 *   - HTTP status changed to >=400 → fail
 *   - added keys only   → warn
 *   - HTTP status changed between healthy statuses → warn
 *
 * @param {object} diff - Result from compareShape().
 * @param {string} probeName - Stable probe identity.
 * @param {object} currentEntry - Normalized current probe entry.
 * @param {object} recordedEntry - Normalized recorded probe entry.
 * @returns {ProbeDiffRecord}
 */
export function classifyProbeDiff(diff, probeName, currentEntry, recordedEntry) {
  const hasBreakingChange = diff.missingKeys.length > 0 ||
    diff.endpointChanged ||
    (diff.httpStatusChanged && Number(currentEntry.httpStatus) >= 400)
  const severity = hasBreakingChange ? 'fail' : 'warn'

  const parts = ['Shape changed: was ' + (recordedEntry.shape || '') + ', now ' + (currentEntry.shape || '')]
  if (diff.addedKeys.length > 0) parts.push('added: ' + diff.addedKeys.join(','))
  if (diff.missingKeys.length > 0) parts.push('missing: ' + diff.missingKeys.join(','))
  if (diff.endpointChanged) parts.push('location changed')
  if (diff.httpStatusChanged) parts.push('http status changed')

  return {
    probe: 'fixture-' + probeName,
    severity,
    message: parts.join('; '),
    diffDetail: {
      addedKeys: diff.addedKeys,
      missingKeys: diff.missingKeys,
      endpointChanged: diff.endpointChanged,
      httpStatusChanged: diff.httpStatusChanged,
    },
  }
}

// ---------------------------------------------------------------------------
// saveSnapshotOrWarn
// ---------------------------------------------------------------------------

/**
 * Save a snapshot to disk and print status messages.
 *
 * @param {object} results - Pass-only probe results, keyed by probeName.
 * @param {string} fixturePath - Full path to the fixture file.
 * @param {object} [meta] - Unused metadata placeholder (backward compat).
 * @returns {boolean} True on success, false on failure.
 */
export function saveSnapshotOrWarn(results, fixturePath, meta) {
  const result = saveSnapshot(results, fixturePath, meta)
  if (!result.success) {
    process.stderr.write('WARN: Failed to save snapshot: ' + result.error + '\n')
    return false
  }
  process.stdout.write('✅ Behavior snapshot saved: ' + fixturePath + '\n')
  return true
}

// ---------------------------------------------------------------------------
// printSecurityWarning
// ---------------------------------------------------------------------------

/**
 * Print the shared security caveat for saved snapshots.
 * Call after every successful --save-fixture write.
 */
export function printSecurityWarning() {
  process.stdout.write(
    'WARNING: Snapshot may contain sensitive data (tokens, profile info). ' +
    'Review content before committing to version control.\n'
  )
}

// ---------------------------------------------------------------------------
// detectProbeDrift
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DriftAdapter
 * @property {(fixtureResults: object) => Record<string, object>} recordedEntryMap
 * @property {(diffRecord: ProbeDiffRecord, context: object) => void} recordDrift
 * @property {(probeName: string, currentEntry: object, fixturePath: string) => void} handleMissingProbe
 * @property {(fixturePath: string) => void} [handleNoFixture]
 */

/**
 * Load a fixture, compare each current normalized probe entry against
 * recorded entries, and emit drift events through the adapter.
 *
 * The adapter owns physical fixture shape and row formatting.
 * The runner owns fixture loading and normalized comparison.
 *
 * @param {Record<string, object>} currentEntries - Normalized probe entries keyed by probeName.
 * @param {string} fixturePath - Path to fixture JSON.
 * @param {DriftAdapter} adapter - Callback object for drift events.
 * @returns {boolean} True if any drift detected.
 */
export function detectProbeDrift(currentEntries, fixturePath, adapter) {
  // Early validation: require at least one current entry and valid adapter methods
  const probeNames = Object.keys(currentEntries || {})
  if (probeNames.length === 0) return false
  if (typeof adapter.recordedEntryMap !== 'function' ||
      typeof adapter.recordDrift !== 'function' ||
      typeof adapter.handleMissingProbe !== 'function') {
    throw new TypeError('detectProbeDrift: adapter must implement recordedEntryMap, recordDrift, and handleMissingProbe')
  }

  const fixture = loadSnapshot(fixturePath)
  if (!fixture || !fixture.results) {
    if (typeof adapter.handleNoFixture === 'function') adapter.handleNoFixture(fixturePath)
    return false
  }

  const recordedEntries = adapter.recordedEntryMap(fixture.results)
  let hasDrift = false

  for (const probeName of probeNames) {
    const current = currentEntries[probeName]
    const recorded = recordedEntries[probeName]

    if (!recorded) {
      hasDrift = true
      adapter.handleMissingProbe(probeName, current, fixturePath)
      continue
    }

    const diff = compareShape(
      { endpoint: recorded.location, httpStatus: recorded.httpStatus, shape: recorded.shape },
      { endpoint: current.location, httpStatus: current.httpStatus, shape: current.shape }
    )
    if (diff.isIdentical) continue

    hasDrift = true
    const diffRecord = classifyProbeDiff(diff, probeName, current, recorded)
    adapter.recordDrift(diffRecord, { probeName, recorded, current, fixturePath })
  }

  return hasDrift
}
