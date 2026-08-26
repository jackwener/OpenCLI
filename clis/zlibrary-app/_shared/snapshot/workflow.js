/**
 * Snapshot Workflow  -  abstract capture-compare-report orchestrator.
 *
 * Eliminates the 5× duplicated lifecycle (capture → build → compare →
 * save/report) across doctor mode files. Each doctor mode provides thin
 * config (capture, buildReport, buildSnapshotData, buildCurrentEntries)
 * and the framework handles the rest.
 *
 * @module _shared/snapshot-workflow
 */

import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from '../infra/url-boundary.js'
import { loadSnapshot, saveSnapshotOrWarn, printSecurityWarning, detectProbeDrift } from './snapshot.js'
import { doctorRow } from './rows.js'

// ---------------------------------------------------------------------------
// classifyFieldHealth
// ---------------------------------------------------------------------------

/**
 * Classify field health status based on non-empty fill ratio.
 *
 * Extracted from doctor-booklist.js duplicate. Used by field-health row format.
 *
 * @param {number} nonEmptyCount - Number of non-empty field values.
 * @param {number} totalItems - Total items expected.
 * @param {'critical'|'warning'} [severity='critical'] - Severity if below threshold.
 * @param {boolean} [allowMissing=false] - If true, 0-filled fields return 'na' instead of 'fail'.
 * @returns {{ status: string, message: string }}
 */
export function classifyFieldHealth (nonEmptyCount, totalItems, severity, allowMissing) {
  const sev = severity || 'critical'
  const ratio = totalItems > 0 ? nonEmptyCount / totalItems : 0

  if (ratio === 1) {
    return { status: 'pass', message: '' }
  }
  if (ratio > 0.5) {
    const pct = Math.round(ratio * 100)
    return { status: 'warn', message: sev === 'critical' ? pct + '% non-empty' : 'low fill rate: ' + pct + '%' }
  }
  // ratio <= 0.5
  if (allowMissing && nonEmptyCount === 0) {
    return { status: 'na', message: 'field not applicable (no data)' }
  }
  return { status: 'fail', message: sev === 'critical' ? 'mostly empty: ' + Math.round(ratio * 100) + '%' : 'low fill rate: ' + Math.round(ratio * 100) + '%' }
}

// ---------------------------------------------------------------------------
// saveSnapshotIfStable
// ---------------------------------------------------------------------------

/**
 * Save snapshot only if all probes are stable (pass).
 * Otherwise print a warning to stderr and skip.
 *
 * @param {object} snapshotData - The snapshot data to save (e.g. { results: {...} }).
 * @param {string} fixturePath - Full path to the fixture file.
 * @param {object} [options]
 * @param {boolean} [options.allPass] - Override stability check. If true, skip check.
 * @returns {boolean} true if saved, false if skipped.
 */
export function saveSnapshotIfStable (snapshotData, fixturePath, options) {
  const opts = options || {}
  const allPass = opts.allPass

  // If allPass is not explicitly provided, assume false (don't save)
  if (!allPass) {
    process.stderr.write('✗ No stable probes  -  nothing to snapshot.\n')
    return false
  }

  const result = saveSnapshotOrWarn(snapshotData, fixturePath)
  if (result) {
    printSecurityWarning()
  }
  return result
}

// ---------------------------------------------------------------------------
// createSnapshotDriftAdapter
// ---------------------------------------------------------------------------

/**
 * Create a standard DriftAdapter for detectProbeDrift().
 *
 * Eliminates 5× duplicate recordedEntryMap / recordDrift / handleMissingProbe
 * / handleNoFixture blocks.
 *
 * @param {object} options
 * @param {Function} options.addRow - Append a drift row to output.
 * @param {string} options.entryKey - Fixture results key (e.g. 'quota', 'bookcard-rows').
 * @param {'api'|'dom-list'|'dom-detail'|'private-dom'} options.sourceKind - Source kind.
 * @param {Function} options.locationFn - Extract location from entry (e => e.path || e.selector).
 * @param {object} [options.fixtureAdapterMap] - Optional custom fixture→entry mapping.
 * @returns {object} DriftAdapter ready for detectProbeDrift()
 */
export function createSnapshotDriftAdapter ({ addRow, entryKey, sourceKind, locationFn, fixtureAdapterMap }) {
  return {
    recordedEntryMap (fixtureResults) {
      // If custom mapping provided, use it (e.g. for multi-entry booklist)
      if (fixtureAdapterMap) {
        const entries = {}
        for (const probeName of Object.keys(fixtureResults)) {
          const r = fixtureResults[probeName]
          entries[probeName] = fixtureAdapterMap(probeName, r)
        }
        return entries
      }

      // Single-entry standard mapping
      const entry = fixtureResults[entryKey]
      if (!entry) return {}
      const location = typeof locationFn === 'function' ? locationFn(entry) : (entry.selector || entry.path || '')
      return {
        [entryKey]: {
          probeName: entryKey,
          sourceKind: sourceKind,
          location: String(location || ''),
          httpStatus: Number(entry.httpStatus ?? 200),
          shape: String(entry.shape || ''),
          observedCount: String(entry.observedCount || ''),
          payload: entry.data || {},
        },
      }
    },

    recordDrift (diffRecord) {
      if (typeof addRow === 'function') {
        addRow(diffRecord)
      }
    },

    handleMissingProbe (probeName, _currentEntry, _fixturePath) {
      if (typeof addRow === 'function') {
        addRow({
          probe: 'fixture-' + probeName,
          severity: 'warn',
          message: 'No fixture entry for this probe  -  run --save-fixture',
        })
      }
    },

    handleNoFixture (fp) {
      process.stdout.write('[HINT] No behavior snapshot found at ' + fp + '. Run with --save-fixture to create one.\n')
    },
  }
}

// ---------------------------------------------------------------------------
// runSnapshotWorkflow
// ---------------------------------------------------------------------------

/**
 * Run the standard snapshot workflow lifecycle.
 *
 * @param {object} options
 * @param {object} options.page - Browser page object (CDP).
 * @param {string} [options.fixturePath] - Path to fixture JSON. Required for normal drift mode.
 * @param {string} options.rowFormat - Format name for row builder (e.g. 'selector-presence').
 * @param {string} options.sourceKind - 'api' | 'dom-list' | 'dom-detail' | 'private-dom'.
 * @param {boolean} [options.saveFixture=false] - From CLI args.
 * @param {boolean} [options.compareDrift=true] - Set false for feature verification.
 * @param {Function} [options.isSnapshotStable] - async ({ rows, data, snapshotData, origin }) => boolean.
 *   Override the default allPass check for save-fixture. Detail mode checks only critical fields.
 * @param {object} [options.navigation] - Optional navigation config.
 * @param {string} options.navigation.path - Relative path to navigate to.
 * @param {number} [options.navigation.settleMs=3000] - Settle time after navigation.
 * @param {Function} options.capture - async (page, origin) => data
 * @param {Function} [options.buildReport] - async (data, origin, ctx) => rows[]
 * @param {Function} [options.buildSnapshotData] - (data, origin) => sanitized data
 * @param {Function} [options.buildCurrentEntries] - async (data, snapshotData, ctx) => { [entryKey]: ProbeEntry }
 * @param {string} [options.entryKey] - Fixture results key for drift adapter.
 * @param {Function} [options.locationFn] - Extract location from fixture entry.
 * @param {object} [options.fixtureAdapterMap] - Custom fixture→entry mapping.
 * @param {Function} [options.createNavRow] - (status, message) => navRow object.
 * @param {object[]} [options.initialRows] - Prepend these rows before workflow output.
 * @returns {Promise<{ rows: object[], success: boolean, fixtureSaved: boolean }>}
 */
export async function runSnapshotWorkflow (options) {
  const {
    page,
    fixturePath,
    rowFormat,
    sourceKind,
    saveFixture = false,
    compareDrift = true,
    isSnapshotStable,
    navigation,
    capture,
    buildReport,
    buildSnapshotData,
    buildCurrentEntries,
    entryKey,
    locationFn,
    fixtureAdapterMap,
    createNavRow,
    initialRows,
  } = options

  const out = initialRows ? initialRows.slice() : []

  // -- 1. Navigation (optional) -------------------------------------------
  /** @type {string} */
  let originStr = ''
  /** @type {URL|undefined} */
  let originUrl
  try {
    originUrl = await getCurrentHttpOrigin(page)
    originStr = originUrl.href.replace(/\/+$/, '')
  } catch (_err) {
    // fallback: if we need page but no origin, some captures may not need it
  }

  if (navigation && navigation.path) {
    try {
      const base = originStr || String(await page.evaluate("window.location.origin")).replace(/\/+$/, '')
      const navUrl = base + '/' + navigation.path.replace(/^\//, '')
      const settleMs = navigation.settleMs || 3000
      await page.goto(navUrl, { waitUntil: 'load', settleMs })
      await assertSameOriginNotLoginWall(page, originUrl || new URL(base), 'runSnapshotWorkflow')
    } catch (err) {
      // If navigation fails, add a nav row and return early
      const msg = err.message || String(err)
      if (typeof createNavRow === 'function') {
        out.push(createNavRow('fail', msg))
      }
      return { rows: out, success: false, fixtureSaved: false }
    }
  }

  // -- 2. Capture -------------------------------------------------------
  let data
  try {
    data = await capture(page, originStr)
  } catch (err) {
    const msg = err.message || String(err)
    if (saveFixture) {
      process.stderr.write('WARN: Capture failed during save-fixture: ' + msg + '\n')
      process.stderr.write('✗ No stable probes  -  nothing to snapshot.\n')
      return { rows: out, success: false, fixtureSaved: false }
    }
    if (typeof createNavRow === 'function') {
      out.push(createNavRow('fail', 'Capture failed: ' + msg))
    }
    return { rows: out, success: false, fixtureSaved: false }
  }

  // Re-fetch origin after navigation
  try {
    const u = await getCurrentHttpOrigin(page)
    originStr = u.href.replace(/\/+$/, '')
  } catch (_err) {
    // keep previous origin
  }

  // -- 3. Build report --------------------------------------------------
  if (typeof buildReport === 'function') {
    const reportRows = await buildReport(data, originStr, { saveFixture })
    for (const r of reportRows) {
      out.push(r)
    }
  }

  // -- 4. Save fixture or drift comparison ------------------------------
  let fixtureSaved = false
  let success = true

  if (saveFixture && typeof buildSnapshotData === 'function') {
    const snapshotData = buildSnapshotData(data, originStr)
    // Determine stability: use isSnapshotStable callback if provided, else default
    var stable
    if (typeof isSnapshotStable === 'function') {
      stable = Boolean(await isSnapshotStable({ rows: out, data, snapshotData, origin: originStr }))
    } else {
      stable = out.every(function (r) { return r.status !== 'fail' })
    }
    var snapshotResults = snapshotData && typeof snapshotData.results !== 'undefined'
      ? snapshotData.results
      : snapshotData
    fixtureSaved = saveSnapshotIfStable(snapshotResults, fixturePath, { allPass: stable })
    return { rows: out, success: stable, fixtureSaved }
  }

  if (!compareDrift) {
    // Feature verification mode  -  no drift check
    return { rows: out, success: true, fixtureSaved: false }
  }

  // Normal mode: load fixture, compare drift
  if (fixturePath && entryKey && typeof buildCurrentEntries === 'function' && typeof buildSnapshotData === 'function') {
    const snapshotData = buildSnapshotData(data, originStr)
    const currentEntries = await buildCurrentEntries(data, snapshotData, { saveFixture })

    const adapter = createSnapshotDriftAdapter({
      addRow: function (diffRecord) {
        out.push(doctorRow({
          probe: diffRecord.probe,
          status: diffRecord.severity,
          count: '',
          sampleValue: '',
          message: diffRecord.message,
        }))
      },
      entryKey: entryKey,
      sourceKind: sourceKind,
      locationFn: locationFn,
      fixtureAdapterMap: fixtureAdapterMap,
    })

    const driftResult = detectProbeDrift(currentEntries, fixturePath, adapter)
    success = driftResult
  }

  return { rows: out, success, fixtureSaved }
}
