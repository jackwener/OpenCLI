/**
 * Z-Library Desktop doctor-booklist command.
 *
 * Merged diagnosis — API current-user + DOM bookcard extraction.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { Strategy } from '@jackwener/opencli/registry'
import { requestBooklistApi, diagnoseExtractBookRows, diagnoseClickLoadMore } from './_shared/booklist/api.js'
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js'
import { deriveShapeFromData, saveSnapshotOrWarn, printSecurityWarning, detectProbeDrift } from './_shared/snapshot/snapshot.js'
import { classifyFieldHealth, createSnapshotDriftAdapter, runSnapshotWorkflow } from './_shared/snapshot/workflow.js'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './_shared/snapshot/rows.js'
import { createSnapshotSanitizer } from './_shared/snapshot/sanitizer.js'
import { normalizeFixtureUrls } from './_shared/fixture/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), '../fixture')
const RAW_URL_BOOK_LIST = 'booklist/27086/cc3f23/101-books.html'
const API_CURRENT_USER_SHAPE_KEYS = ['id', 'title']

const sanitizeBooklistCurrentUser = createSnapshotSanitizer({
  valueByKey: { id: 0, title: '[REDACTED]' },
})

const FIELD_META = [
  { key: 'bookId',            severity: 'critical',  isNonEmpty: function (r) { return r.bookId !== '' } },
  { key: 'url',               severity: 'critical',  isNonEmpty: function (r) { return r.url !== '' } },
  { key: 'title',             severity: 'critical',  isNonEmpty: function (r) { return r.title !== '' } },
  { key: 'author',            severity: 'important', isNonEmpty: function (r) { return r.author !== '' } },
  { key: 'language',          severity: 'important', isNonEmpty: function (r) { return r.language !== '' } },
  { key: 'extension',         severity: 'important', isNonEmpty: function (r) { return r.extension !== '' } },
  { key: 'size',              severity: 'important', isNonEmpty: function (r) { return r.size !== '' } },
  { key: 'md5',               severity: 'important', isNonEmpty: function (r) { return r.md5 !== '' } },
  { key: 'formatQualityRating', severity: 'optional', naWhenAllNull: true, isNonEmpty: function (r) { return r.formatQualityRating != null } },
  { key: 'qualityRating',       severity: 'optional', naWhenAllNull: true, isNonEmpty: function (r) { return r.qualityRating != null } },
  { key: 'publisher',         severity: 'optional',  isNonEmpty: function (r) { return r.publisher !== '' } },
  { key: 'isbn',              severity: 'optional',  isNonEmpty: function (r) { return r.isbn !== '' } },
  { key: 'series',            severity: 'optional',  isNonEmpty: function (r) { return r.series !== '' } },
  { key: 'categories',        severity: 'optional',  isNonEmpty: function (r) { return r.categories !== '' } },
]

function pathSlug (normalizedPath) {
  var last = normalizedPath.split('/').filter(Boolean).pop() || 'default'
  return last.replace(/\.html$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-') || 'default'
}

function sleep (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

async function waitForBookcardHydration (page) {
  try {
    await page.wait(1500)
  } catch (_) {}

  for (var retry = 0; retry < 12; retry++) {
    try {
      var found = await page.evaluate('!!document.querySelector("z-bookcard")')
      if (found) return true
    } catch (_) {}
    await sleep(250)
  }

  return false
}

export async function execDomPhase (page, args) {
  var saveFixture = args['save-fixture'] || false
  var variant = pathSlug(RAW_URL_BOOK_LIST.startsWith('/') ? RAW_URL_BOOK_LIST : '/' + RAW_URL_BOOK_LIST)
  var fixturePath = path.join(FIXTURE_DIR, 'bookcard-' + variant + '.json')
  var normalizedPath = RAW_URL_BOOK_LIST.startsWith('/') ? RAW_URL_BOOK_LIST : '/' + RAW_URL_BOOK_LIST

  var capturedFieldResults

  var { rows } = await runSnapshotWorkflow({
    page,
    fixturePath,
    saveFixture,
    sourceKind: 'dom-list',
    navigation: { path: RAW_URL_BOOK_LIST, settleMs: 4000 },
    createNavRow: (status, message) => doctorNavRow('booklist', status, message),

    isSnapshotStable: function () {
      if (!capturedFieldResults) return false
      return capturedFieldResults
        .filter(function (f) { return f.severity === 'critical' })
        .every(function (f) { return f.status === 'pass' })
    },

    capture: async (p, origin) => {
      await waitForBookcardHydration(p)
      var books = await diagnoseExtractBookRows(p, origin, 0)
      return { books, normalizedPath }
    },

    async buildReport (captured) {
      var books = captured.books || []
      var totalBooks = books.length
      var out = [doctorNavRow('booklist', 'pass', 'navigated to ' + normalizedPath + '; ' + totalBooks + ' books found')]

      out.push(doctorRow({
        probe: 'bookcard-count',
        status: totalBooks > 0 ? 'pass' : 'fail',
        count: totalBooks > 0 ? totalBooks : '0',
        sampleValue: totalBooks > 0 ? books[0].title : '',
        message: totalBooks > 0 ? '' : 'no z-bookcard elements found',
      }))

      if (totalBooks === 0) return out

      var fieldResults = FIELD_META.map(function (meta) {
        var nonEmptyCount = books.filter(meta.isNonEmpty).length
        var fhSev = meta.severity === 'critical' ? 'critical' : 'warning'
        var result = classifyFieldHealth(nonEmptyCount, totalBooks, fhSev)
        var status = result.status
        var msg = result.message
        if (meta.naWhenAllNull && nonEmptyCount === 0) { status = 'na'; msg = 'all null per convention' }
        var sampleBook = books.find(meta.isNonEmpty)
        var sampleValue = sampleBook ? String(sampleBook[meta.key] || '') : ''
        return { key: meta.key, severity: meta.severity, nonEmptyCount, status, message: msg, sampleValue }
      })

      var summaryParts = fieldResults.map(function (f) { return f.key + ':' + f.nonEmptyCount + '/' + totalBooks })
      var allCriticalPass = fieldResults.filter(function (f) { return f.severity === 'critical' }).every(function (f) { return f.status === 'pass' })
      var anyFail = fieldResults.some(function (f) { return f.status === 'fail' })

      out.push(doctorRow({
        probe: 'field-summary',
        status: allCriticalPass && !anyFail ? 'pass' : (anyFail ? 'fail' : 'warn'),
        count: totalBooks,
        sampleValue: '',
        message: summaryParts.join(' '),
      }))

      fieldResults.filter(function (f) { return f.status === 'warn' || f.status === 'fail' || f.status === 'na' }).forEach(function (f) {
        out.push(doctorRow({
          probe: 'field-' + f.key,
          status: f.status,
          count: String(f.nonEmptyCount) + '/' + String(totalBooks),
          sampleValue: f.sampleValue,
          message: f.message,
        }))
      })

      // Pagination probe
      var EXPECT_PAGINATION_THRESHOLD = 20
      try {
        await (async function probePg () {
          var loadMoreExists
          try { loadMoreExists = await page.evaluate('!!document.querySelector("div.page-load-more")') } catch (_) { loadMoreExists = false }

          if (totalBooks < EXPECT_PAGINATION_THRESHOLD && !loadMoreExists) {
            out.push(doctorRow({ probe: 'pagination-load-more', status: 'na', count: totalBooks, sampleValue: '', message: 'only ' + totalBooks + ' books; load-more not expected' }))
          } else if (!loadMoreExists) {
            out.push(doctorRow({ probe: 'pagination-load-more', status: 'warn', count: totalBooks, sampleValue: '', message: totalBooks + ' books but no div.page-load-more' }))
          } else {
            var beforeCount = totalBooks
            var clicked = await diagnoseClickLoadMore(page)
            if (clicked) {
              var afterCount = beforeCount
              for (var i = 0; i < 20; i++) {
                await sleep(500)
                var ab = await diagnoseExtractBookRows(page, 'ignore', 99999)
                if (ab.length > beforeCount) { afterCount = ab.length; break }
              }
              out.push(doctorRow({
                probe: 'pagination-load-more',
                status: afterCount > beforeCount ? 'pass' : 'warn',
                count: String(beforeCount) + '\u2192' + String(afterCount),
                sampleValue: '',
                message: afterCount > beforeCount ? 'load-more worked' : 'load-more clicked but no new books',
              }))
            } else {
              out.push(doctorRow({ probe: 'pagination-load-more', status: 'warn', count: beforeCount, sampleValue: '', message: 'load-more found but click failed' }))
            }
          }
        })()
      } catch (err) {
        out.push(doctorRow({ probe: 'pagination-load-more', status: 'fail', count: '', sampleValue: '', message: 'Pagination error: ' + (err.message || String(err)) }))
      }

      captured.fieldResults = fieldResults
      captured.books = books
      capturedFieldResults = fieldResults

      return out
    },

    buildSnapshotData (captured) {
      var books = captured.books || []
      var fixtureBooks = normalizeFixtureUrls(books, { url: 'url_path' })
      return {
        results: {
          'bookcard-rows': {
            path: normalizedPath, httpStatus: 200,
            shape: deriveShapeFromData(fixtureBooks),
            observedCount: String(fixtureBooks.length),
            data: fixtureBooks,
          },
        },
      }
    },

    buildCurrentEntries (_data, snapshotData) {
      var r = snapshotData.results['bookcard-rows']
      return {
        'bookcard-rows': {
          probeName: 'bookcard-rows', sourceKind: 'dom-list',
          location: r.path || r.selector || '', httpStatus: 200,
          shape: r.shape || '', observedCount: String(r.observedCount || ''),
          payload: r.data || [],
        },
      }
    },

    entryKey: 'bookcard-rows',
    locationFn: function (e) { return e.path || e.selector || '' },
    initialRows: [],
  })

  return rows
}

export const doctorBooklistCommand = {
  site: 'zlibrary-app',
  name: 'doctor-booklist',
  access: 'read',
  description: 'Merged booklist diagnosis — API current-user + DOM bookcard extraction',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'save-fixture', type: 'boolean', required: false, default: false, description: 'Save both phase fixtures' }],
  columns: DOCTOR_OUTPUT_COLUMNS,
  func: async (page, args) => {
    var saveFixture = args['save-fixture'] || false
    var fixturePathApi = path.join(FIXTURE_DIR, 'booklist-anonymous.json')

    // Phase A: API
    var apiProbeStatus = 'fail', apiShape = '', apiObserved = '', apiMessage = '', apiHttpStatus = '', responseData = null
    try {
      await getCurrentHttpOrigin(page)
      var data = await requestBooklistApi(page, '/papi/booklist/current-user/', { allowError: true })
      responseData = data
      if (data && data.error) {
        apiHttpStatus = String(data._httpStatus || ''); apiMessage = data.error
      } else if (data && !data.error) {
        apiProbeStatus = 'pass'; apiHttpStatus = '200'
        apiShape = deriveShapeFromData(data)
        var isApiWrapper = typeof data === 'object' && data !== null && !Array.isArray(data) && 'success' in data && 'list' in data && Array.isArray(data.list)
        if (isApiWrapper) {
          var listData = data.list
          apiObserved = listData.length > 0 ? String(listData.length) : '0'
          if (listData.length > 0) {
            var foundKeys = API_CURRENT_USER_SHAPE_KEYS.filter(function (k) { return k in listData[0] })
            if (foundKeys.length < API_CURRENT_USER_SHAPE_KEYS.length) {
              apiProbeStatus = 'fail'
              apiMessage = 'missing keys: ' + API_CURRENT_USER_SHAPE_KEYS.filter(function (k) { return !(k in listData[0]) }).join(',')
            }
          }
        } else if (Array.isArray(data)) { apiObserved = String(data.length) }
        else if (typeof data === 'object') { apiObserved = 'object' }
      } else { apiMessage = 'empty response' }
    } catch (err) { apiMessage = err.message || String(err) }

    // Phase B: DOM
    var domOut = await execDomPhase(page, args)

    if (saveFixture) {
      if (apiProbeStatus === 'pass') {
        var sanitizedResponse = responseData ? sanitizeBooklistCurrentUser(responseData) : null
        var apiSnapshot = {
          results: {
            'api-current-user': {
              endpoint: '/papi/booklist/current-user/', httpStatus: 200,
              shape: apiShape, observedCount: apiObserved, response: sanitizedResponse,
            },
          },
        }
        if (saveSnapshotOrWarn(apiSnapshot.results, fixturePathApi)) printSecurityWarning()
      } else { process.stderr.write('\u2717 API: no stable probes\n') }
      return []
    }

    var mergedOut = []
    mergedOut.push(doctorRow({ probe: 'api-current-user', status: apiProbeStatus, count: apiObserved, sampleValue: apiShape, message: apiMessage }))

    // API drift
    detectProbeDrift({
      'api-current-user': {
        probeName: 'api-current-user', sourceKind: 'api', location: '/papi/booklist/current-user/',
        httpStatus: apiHttpStatus !== '' ? Number(apiHttpStatus) : 0,
        shape: apiShape, observedCount: apiObserved,
        payload: responseData && apiProbeStatus === 'pass' ? sanitizeBooklistCurrentUser(responseData) : {},
      },
    }, fixturePathApi, createSnapshotDriftAdapter({
      addRow: function (dr) { mergedOut.push(doctorRow({ probe: dr.probe, status: dr.severity, count: '', sampleValue: '', message: dr.message })) },
      entryKey: 'api-current-user', sourceKind: 'api',
      locationFn: function (e) { return e.endpoint || '' },
    }))

    for (var domRow of domOut) { mergedOut.push(domRow) }
    return mergedOut
  },
}
