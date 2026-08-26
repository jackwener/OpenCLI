/**
 * Z-Library Desktop doctor-dom-detail command.
 *
 * DOM extraction diagnosis for book detail page — probes single book detail page
 * via hardcoded target (Astronomy 101, bookId=2316106).
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { Strategy } from '@jackwener/opencli/registry'
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js'
import { deriveShapeFromData, saveSnapshotOrWarn, printSecurityWarning, detectProbeDrift } from './_shared/snapshot/snapshot.js'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './_shared/snapshot/rows.js'
import { normalizeFixtureUrls } from './_shared/fixture/index.js'
import { extractBookCardAttributes, extractBookDetailAttributes } from '../zlibrary/dom.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), '../fixture/book-detail')

const FIELD_META = [
  { probe: 'card',   key: 'bookId',        severity: 'critical' },
  { probe: 'card',   key: 'title',         severity: 'critical' },
  { probe: 'card',   key: 'author',        severity: 'important' },
  { probe: 'detail', key: 'year',          severity: 'important' },
  { probe: 'detail', key: 'language',      severity: 'important' },
  { probe: 'detail', key: 'extension',     severity: 'important' },
  { probe: 'detail', key: 'filesize',      severity: 'important' },
  { probe: 'detail', key: 'rating',        severity: 'important' },
  { probe: 'detail', key: 'publisher',     severity: 'optional' },
  { probe: 'card',   key: 'isbn',          severity: 'optional' },
  { probe: 'detail', key: 'pages',         severity: 'important' },
  { probe: 'detail', key: 'isbn10',        severity: 'optional' },
  { probe: 'detail', key: 'isbn13',        severity: 'optional' },
  { probe: 'detail', key: 'series',        severity: 'optional',  allowMissing: true },
  { probe: 'detail', key: 'volume',        severity: 'optional',  allowMissing: true },
  { probe: 'detail', key: 'categories',    severity: 'optional' },
  { probe: 'detail', key: 'description',   severity: 'important' },
  { probe: 'detail', key: 'metaDescription', severity: 'optional' },
  { probe: 'detail', key: 'mainFormat',    severity: 'optional' },
  { probe: 'detail', key: 'quality',       severity: 'optional' },
]

const RAW_URL_BOOK_DETAIL = '/book/D2RAkwnKvL/astronomy-101.html'

function classifyField (nonEmptyCount, totalBooks, severity, allowMissing) {
  if (totalBooks === 0) return { status: 'na', message: 'No data available' }
  if (nonEmptyCount === 0) {
    if (severity === 'critical') return { status: 'fail', message: '0% populated' }
    if (allowMissing) return { status: 'na', message: 'Not available for this book' }
    return { status: 'warn', message: '0% populated' }
  }
  if (nonEmptyCount === totalBooks) return { status: 'pass', message: '100% populated' }
  var ratio = nonEmptyCount / totalBooks
  if (severity === 'critical' && ratio < 1) return { status: 'warn', message: 'degraded:' + nonEmptyCount + '/' + totalBooks }
  if (ratio <= 0.5) return { status: 'warn', message: 'degraded:' + nonEmptyCount + '/' + totalBooks }
  return { status: 'pass', message: String(nonEmptyCount) + '/' + String(totalBooks) + ' populated' }
}

export const doctorDomDetailCommand = {
  site: 'zlibrary-app',
  name: 'doctor-dom-detail',
  access: 'read',
  description: 'DOM extraction diagnosis for book detail page',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'save-fixture', type: 'boolean', required: false, default: false, description: 'Save snapshot' }],
  columns: DOCTOR_OUTPUT_COLUMNS,
  func: async (page, args) => {
    var saveFixture = args['save-fixture'] || false
    var fixturePath = path.join(FIXTURE_DIR, 'book-detail-sample.json')

    try {
      var originUrl
      try { originUrl = await getCurrentHttpOrigin(page) }
      catch (err) {
        if (saveFixture) {
          process.stderr.write('WARN: Unable to read current origin during save-fixture: ' + (err.message || String(err)) + '\n')
          process.stderr.write('✗ No stable probes — nothing to snapshot.\n')
          return []
        }
        return [doctorNavRow('detail', 'fail', 'Unable to read current origin: ' + (err.message || String(err)))]
      }

      var navUrl = originUrl.origin.replace(/\/+$/, '') + RAW_URL_BOOK_DETAIL
      try {
        await page.goto(navUrl, { waitUntil: 'load', settleMs: 2000 })
        await new Promise(function (r) { setTimeout(r, 500) })
      } catch (err) {
        if (saveFixture) {
          process.stderr.write('✗ No stable probes — nothing to snapshot.\n')
          return []
        }
        return [doctorNavRow('detail', 'fail', 'Navigation failed: ' + (err.message || String(err)))]
      }

      try { await assertSameOriginNotLoginWall(page, originUrl, 'doctor-dom-detail') }
      catch (err) {
        if (saveFixture) {
          process.stderr.write('✗ No stable probes — nothing to snapshot.\n')
          return []
        }
        return [doctorNavRow('detail', 'fail', 'Navigation validation: ' + (err.message || String(err)))]
      }

      var cardData = {}
      var detailData = {}
      try { cardData = await extractBookCardAttributes(page) } catch (err) { process.stderr.write('WARN: card extraction: ' + (err.message || String(err)) + '\n') }
      try { detailData = await extractBookDetailAttributes(page) } catch (err) { process.stderr.write('WARN: detail extraction: ' + (err.message || String(err)) + '\n') }

      var totalBooks = 1
      var out = []
      var allCriticalPass = true

      for (var fi = 0; fi < FIELD_META.length; fi++) {
        var meta = FIELD_META[fi]
        var sourceData = meta.probe === 'card' ? cardData : detailData
        var val = sourceData[meta.key]
        var nonEmptyCount = (val != null && String(val).trim() !== '') ? 1 : 0
        var classification = classifyField(nonEmptyCount, totalBooks, meta.severity, meta.allowMissing)

        if (meta.severity === 'critical' && classification.status !== 'pass') allCriticalPass = false

        out.push(doctorRow({
          probe: 'book-detail-' + meta.key,
          status: classification.status,
          count: nonEmptyCount,
          sampleValue: String(val ?? ''),
          message: meta.probe + '/' + meta.severity + (classification.message ? ': ' + classification.message : ''),
        }))
      }

      // Navigation success row (prepend)
      out.unshift(doctorNavRow('detail', 'pass', 'navigated to ' + RAW_URL_BOOK_DETAIL))

      // Drift comparison
      var currentUrl = ''
      try { currentUrl = String(await page.evaluate('window.location.href') || '') } catch (_) {}

      if (!saveFixture) {
        var normalizedCard = normalizeFixtureUrls(cardData, { href: 'url_path' })
        var detailCurrentEntries = {
          'book-detail-card': {
            probeName: 'book-detail-card', sourceKind: 'dom-detail',
            location: RAW_URL_BOOK_DETAIL, httpStatus: 200,
            shape: deriveShapeFromData(normalizedCard),
            observedCount: String(Object.keys(cardData).length),
            payload: normalizedCard,
          },
          'book-detail-detail': {
            probeName: 'book-detail-detail', sourceKind: 'dom-detail',
            location: RAW_URL_BOOK_DETAIL, httpStatus: 200,
            shape: deriveShapeFromData(detailData),
            observedCount: String(Object.keys(detailData).length),
            payload: detailData,
          },
        }

        detectProbeDrift(detailCurrentEntries, fixturePath, {
          recordedEntryMap (fixtureResults) {
            var entries = {}
            var probeKeys = ['book-detail-card', 'book-detail-detail']

            // New format: fixtureResults IS { 'book-detail-card': {...}, 'book-detail-detail': {...} }
            for (var pi = 0; pi < probeKeys.length; pi++) {
              var pk = probeKeys[pi]
              var r = fixtureResults[pk]
              if (r) {
                entries[pk] = {
                  probeName: pk, sourceKind: 'dom-detail', location: r.path || RAW_URL_BOOK_DETAIL,
                  httpStatus: Number(r.httpStatus ?? 200), shape: r.shape || '',
                  observedCount: String(r.observedCount || ''), payload: r.data || {},
                }
              }
            }

            // Old format fallback: fixtureResults has { card: {...}, detail: {...} }
              if (fixtureResults.card && !entries['book-detail-card']) {
                entries['book-detail-card'] = {
                  probeName: 'book-detail-card', sourceKind: 'dom-detail', location: RAW_URL_BOOK_DETAIL,
                  httpStatus: 200, shape: deriveShapeFromData(fixtureResults.card),
                  observedCount: String(Object.keys(fixtureResults.card).length), payload: fixtureResults.card,
                }
              }
              if (fixtureResults.detail && !entries['book-detail-detail']) {
                entries['book-detail-detail'] = {
                  probeName: 'book-detail-detail', sourceKind: 'dom-detail', location: RAW_URL_BOOK_DETAIL,
                  httpStatus: 200, shape: deriveShapeFromData(fixtureResults.detail),
                  observedCount: String(Object.keys(fixtureResults.detail).length), payload: fixtureResults.detail,
                }
              }

            return entries
          },
          recordDrift (diffRecord) {
            out.push(doctorRow({ probe: diffRecord.probe, status: diffRecord.severity, count: '', sampleValue: '', message: diffRecord.message }))
            for (var oi = 0; oi < out.length; oi++) {
              if (out[oi].status === 'pass') { out[oi].status = 'warn'; out[oi].message = 'pass but shape drift detected' }
            }
          },
          handleMissingProbe (probeName) {
            out.push(doctorRow({ probe: 'fixture-' + probeName, status: 'warn', count: '', sampleValue: '', message: 'No fixture entry — run --save-fixture' }))
          },
          handleNoFixture (fp) { process.stdout.write('[HINT] No snapshot at ' + fp + '.\n') },
        })
      }

      if (saveFixture) {
        if (!allCriticalPass) { process.stderr.write('✗ No stable probes — nothing to snapshot.\n'); return [] }

        var normalizedCardF = normalizeFixtureUrls(cardData, { href: 'url_path' })
        var snapshotData = {
          results: {
            'book-detail-card': {
              path: RAW_URL_BOOK_DETAIL, httpStatus: 200,
              shape: deriveShapeFromData(normalizedCardF),
              observedCount: String(Object.keys(cardData).length), data: normalizedCardF,
            },
            'book-detail-detail': {
              path: RAW_URL_BOOK_DETAIL, httpStatus: 200,
              shape: deriveShapeFromData(detailData),
              observedCount: String(Object.keys(detailData).length), data: detailData,
            },
          },
        }

        fs.mkdirSync(FIXTURE_DIR, { recursive: true })
        if (saveSnapshotOrWarn(snapshotData.results, fixturePath)) printSecurityWarning()
        return []
      }

      return out
    } catch (err) {
      if (saveFixture) { process.stderr.write('✗ Error: ' + (err.message || String(err)) + '\n'); return [] }
      return [doctorNavRow('detail', 'fail', 'Unexpected error: ' + (err.message || String(err)))]
    }
  },
}
