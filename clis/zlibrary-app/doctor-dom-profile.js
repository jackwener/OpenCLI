/**
 * Z-Library Desktop doctor-dom-profile command.
 *
 * DOM extraction diagnosis — probes profile selectors on /profileEdit page.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { Strategy } from '@jackwener/opencli/registry'
import { deriveShapeFromData } from './_shared/snapshot/snapshot.js'
import { runSnapshotWorkflow } from './_shared/snapshot/workflow.js'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './_shared/snapshot/rows.js'
import { createSnapshotSanitizer } from './_shared/snapshot/sanitizer.js'
import { extractProfileSnapshotFromDom } from './profile-read.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), '../fixture')

const sanitizeProfile = createSnapshotSanitizer({
  valueByKey: { username: '[REDACTED]', accountTier: '[REDACTED]' },
})

export const doctorDomProfileCommand = {
  site: 'zlibrary-app',
  name: 'doctor-dom-profile',
  access: 'read',
  description: 'DOM extraction diagnosis — probes profile selectors on /profileEdit page',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'save-fixture', type: 'boolean', required: false, default: false, description: 'Save snapshot' }],
  columns: DOCTOR_OUTPUT_COLUMNS,
  func: async (page, args) => {
    const saveFixture = args['save-fixture'] || false
    const fixturePath = path.join(FIXTURE_DIR, 'profile-default.json')

    const { rows } = await runSnapshotWorkflow({
      page,
      fixturePath,
      saveFixture,
      sourceKind: 'private-dom',
      createNavRow: (status, message) => doctorNavRow('profile', status, message),

      capture: (p) => extractProfileSnapshotFromDom(p),

      buildReport (profileData) {
        const data = profileData && typeof profileData === 'object' ? profileData : {}
        const checks = [
          { probe: 'nav-card-element', key: 'navCardElement', expected: 'found', isOk: (v) => v === 'found' },
          { probe: 'username',         key: 'username',       expected: 'Non-empty string', isOk: (v) => v.trim() !== '' },
          { probe: 'account-tier',     key: 'accountTier',    expected: 'Non-empty string', isOk: (v) => v.trim() !== '' },
          { probe: 'filename-format',  key: 'filenameFormat', expected: 'Filename template', isOk: (v) => v !== 'not found' && v.trim() !== '' },
        ]

        const out = [doctorNavRow('profile', 'pass', 'navigated to /profileEdit')]

        for (const c of checks) {
          const val = data[c.key]
          const ok = typeof val === 'string' && c.isOk(val)
          out.push(doctorRow({
            probe: c.probe,
            status: ok ? 'pass' : 'fail',
            count: ok ? 1 : 0,
            sampleValue: String(val ?? ''),
            message: 'selector=' + c.key + '; expected=' + c.expected,
          }))
        }
        return out
      },

      buildSnapshotData (profileData) {
        const sanitized = sanitizeProfile(profileData)
        const data = sanitized && typeof sanitized === 'object' ? sanitized : {}
        return {
          results: {
            'profile-selectors': {
              selector: 'profile DOM data',
              shape: deriveShapeFromData(data),
              observedCount: String(Object.keys(data).length),
              data,
            },
          },
        }
      },

      buildCurrentEntries (_data, snapshotData) {
        const entries = {}
        const results = snapshotData.results || {}
        for (const probeName of Object.keys(results)) {
          const r = results[probeName]
          entries[probeName] = {
            probeName, sourceKind: 'private-dom',
            location: r.selector || '', httpStatus: 200,
            shape: r.shape || '', observedCount: r.observedCount || '',
            payload: r.data || {},
          }
        }
        return entries
      },

      entryKey: 'profile-selectors',
      locationFn: (e) => e.selector || '',
    })

    return rows
  },
}
