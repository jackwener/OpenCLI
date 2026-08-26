/**
 * Z-Library Desktop doctor-dom-search command.
 *
 * DOM extraction diagnosis — probes search result selectors on a live search page.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { Strategy } from '@jackwener/opencli/registry'
import { deriveShapeFromData } from './_shared/snapshot/snapshot.js'
import { runSnapshotWorkflow } from './_shared/snapshot/workflow.js'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './_shared/snapshot/rows.js'
import { normalizeFixtureUrls } from './_shared/fixture/index.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGE_BY_CODE } from '../zlibrary/dom.js'
import { collectSearchResultsPage, buildFilterQueryString, toArray, filterByExtension, filterByLanguage, filterByContentType, filterByYearRange, filterByFakeEntries } from './_shared/infra/search-pipeline.js'

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), '../fixture')

function querySlug (value) {
  return String(value || 'test').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'test'
}

export const doctorDomSearchCommand = {
  site: 'zlibrary-app',
  name: 'doctor-dom-search',
  access: 'read',
  description: 'DOM extraction diagnosis — probes search result selectors on a live search page',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'query', type: 'string', required: false, default: 'Python', description: 'Search query' },
    { name: 'filter-lang-codes', type: 'string', required: false, description: 'ISO language codes' },
    { name: 'filter-ext', type: 'string', required: false, description: 'File extensions' },
    { name: 'filter-content-type', type: 'string', required: false, description: 'Content types' },
    { name: 'filter-year-from', type: 'number', required: false, description: 'Min year' },
    { name: 'filter-year-to', type: 'number', required: false, description: 'Max year' },
    { name: 'filter-exact-matching', type: 'boolean', required: false, default: false, description: 'Exact matching' },
    { name: 'save-fixture', type: 'boolean', required: false, default: false, description: 'Save snapshot' },
  ],
  columns: DOCTOR_OUTPUT_COLUMNS,
  func: async (page, args) => {
    const query = String(args.query ?? 'Python').trim() || 'Python'
    const saveFixture = args['save-fixture'] || false
    const variant = 'query-' + querySlug(query)
    const fixturePath = path.join(FIXTURE_DIR, 'search-' + variant + '.json')

    const filterLangs = toArray(args['filter-lang-codes']).length ? toArray(args['filter-lang-codes']) : ['zh']
    const filterExts = toArray(args['filter-ext']).length ? toArray(args['filter-ext']) : ['epub']
    const filterTypes = toArray(args['filter-content-type']).length ? toArray(args['filter-content-type']) : ['book']
    const filterYearFrom = args['filter-year-from'] ?? 2005
    const filterYearTo = args['filter-year-to'] ?? 2010
    const filterExact = Boolean(args['filter-exact-matching'])

    const filterQs = buildFilterQueryString(filterLangs, filterExts, filterTypes, filterYearFrom, filterYearTo, LANGUAGE_BY_CODE, filterExact)

    const { rows } = await runSnapshotWorkflow({
      page,
      fixturePath,
      saveFixture,
      sourceKind: 'dom-list',
      createNavRow: (status, message) => doctorNavRow('search', status, message),

      capture: async (p, origin) => {
        const startOrigin = { origin: String(origin || '').trim().replace(/\/+$/, '') }
        const collected = await collectSearchResultsPage(p, startOrigin, query, { limit: 100, filterQs, contextName: 'zlibrary-app doctor-dom-search' })
        return collected
      },

      buildReport (collected) {
        const results = collected.results || []
        const searchPath = collected.searchPath || ''
        const rawTotalResults = results.length

        let filtered = filterByExtension(results, filterExts)
        filtered = filterByLanguage(filtered, filterLangs)
        filtered = filterByContentType(filtered, filterTypes)
        filtered = filterByYearRange(filtered, filterYearFrom, filterYearTo)
        filtered = filterByFakeEntries(filtered)

        const filteredTotalResults = filtered.length

        const out = [doctorNavRow('search', 'pass', 'navigated to ' + searchPath + '; ' + rawTotalResults + ' results (' + filteredTotalResults + ' after filters)')]

        if (filteredTotalResults === 0) {
          out.push(doctorRow({ probe: 'search-results-count', status: 'fail', count: 0, sampleValue: '', message: 'no results after filters' }))
          return out
        }

        out.push(doctorRow({ probe: 'search-results-count', status: 'pass', count: filteredTotalResults, sampleValue: filtered[0]?.title ?? '', message: '' }))

        collected.filteredResults = filtered
        collected.searchPath = searchPath
        collected.rawTotalResults = rawTotalResults

        return out
      },

      buildSnapshotData (collected) {
        const filteredResults = collected.filteredResults || []
        const searchPath = collected.searchPath || ''
        const rawTotalResults = collected.rawTotalResults || 0
        const filteredTotalResults = filteredResults.length

        const fixtureData = normalizeFixtureUrls(filteredResults, { url: 'url_path' })

        return {
          results: {
            'search-rows': {
              endpoint: searchPath,
              httpStatus: 200,
              selector: "[data-testid='search-results']",
              shape: deriveShapeFromData(fixtureData),
              observedCount: String(filteredTotalResults),
              data: { rows: fixtureData, extra: { rawObservedCount: String(rawTotalResults), query } },
            },
          },
        }
      },

      buildCurrentEntries (_data, snapshotData) {
        const r = snapshotData.results['search-rows']
        return {
          'search-rows': {
            probeName: 'search-rows',
            sourceKind: 'dom-list',
            location: r.endpoint || '',
            httpStatus: 200,
            shape: r.shape || '',
            observedCount: r.observedCount || '',
            payload: r.data || [],
          },
        }
      },

      entryKey: 'search-rows',
      locationFn: (e) => e.endpoint || e.selector || '',
    })

    return rows
  },
}
