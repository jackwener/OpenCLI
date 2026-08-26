/**
 * Z-Library Desktop doctor-dom-quota command.
 *
 * DOM extraction diagnosis — probes quota selectors on /users/downloads page.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */

import { Strategy } from '@jackwener/opencli/registry'
import { deriveShapeFromData } from './_shared/snapshot/snapshot.js'
import { runSnapshotWorkflow } from './_shared/snapshot/workflow.js'
import { DOCTOR_OUTPUT_COLUMNS, doctorRow, doctorNavRow } from './_shared/snapshot/rows.js'
import { extractQuotaSnapshotFromDom } from './_shared/quota/checker.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = path.resolve(fileURLToPath(import.meta.url), '../fixture')

export const doctorDomQuotaCommand = {
  site: 'zlibrary-app',
  name: 'doctor-dom-quota',
  access: 'read',
  description: 'DOM extraction diagnosis — probes quota selectors on /users/downloads page',
  domain: 'localhost',
  strategy: Strategy.UI,
  args: [{ name: 'save-fixture', type: 'boolean', required: false, default: false, description: 'Save snapshot' }],
  browser: true,
  columns: DOCTOR_OUTPUT_COLUMNS,
  func: async (page, args) => {
    const fixturePath = path.join(FIXTURE_DIR, 'quota-default.json')
    const saveFixture = args['save-fixture'] || false

    const { rows } = await runSnapshotWorkflow({
      page,
      fixturePath,
      saveFixture,
      sourceKind: 'private-dom',
      createNavRow: (status, message) => doctorNavRow('quota', status, message),

      capture: (p) => extractQuotaSnapshotFromDom(p),

      buildReport (domData) {
        const data = domData && typeof domData === 'object' ? domData : {}
        const checks = [
          { probe: 'quota-count',       key: 'countText',     expected: 'Non-empty N/N text' },
          { probe: 'quota-reset',       key: 'resetText',     expected: 'Non-empty reset text' },
          { probe: 'quota-progress-bar', key: 'progressExists', expected: 'Progress bar exists' },
        ]

        const out = [doctorNavRow('quota', 'pass', 'navigated to /users/downloads')]

        for (const c of checks) {
          const val = c.key === 'progressExists' ? data.progressExists : data[c.key]
          const ok = c.key === 'progressExists'
            ? typeof val === 'boolean' && val
            : typeof val === 'string' && val.trim() !== ''
          out.push(doctorRow({
            probe: c.probe,
            status: ok ? 'pass' : 'fail',
            count: ok ? 1 : 0,
            sampleValue: typeof val === 'string' && val.length > 100 ? val.slice(0, 100) + '\u2026' : String(val ?? ''),
            message: 'selector=' + c.key + '; expected=' + c.expected,
          }))
        }

        const parsedCount = data.parsedCount
        const parsedCountOk = parsedCount && typeof parsedCount === 'object' &&
          typeof parsedCount.used === 'number' &&
          typeof parsedCount.limit === 'number' &&
          typeof parsedCount.remaining === 'number'
        if (!parsedCountOk) {
          out.push(doctorRow({
            probe: 'quota-parsed-type',
            status: 'fail',
            count: 0,
            sampleValue: String(parsedCount ?? ''),
            message: 'parsedCount fields must be numbers',
          }))
        }

        const hasProgressAriaNow = Object.prototype.hasOwnProperty.call(data, 'progressAriaNow')
        const progressAriaNowOk = hasProgressAriaNow && (data.progressAriaNow === null || typeof data.progressAriaNow === 'number')
        if (!progressAriaNowOk) {
          out.push(doctorRow({
            probe: 'quota-progress-type',
            status: 'fail',
            count: 0,
            sampleValue: String(data.progressAriaNow ?? ''),
            message: 'progressAriaNow must be a number or null',
          }))
        }
        return out
      },

      buildSnapshotData (domData) {
        const data = domData && typeof domData === 'object' ? domData : {}
        return {
          results: {
            quota: {
              selector: 'Quota DOM extraction',
              shape: deriveShapeFromData(data),
              observedCount: String(Object.keys(data).length),
              data: {
                countText: '0 / 0',
                resetText: data.resetText ? '[RESET_COUNTDOWN]' : '',
                progressExists: Boolean(data.progressExists),
                progressAriaNow: data.progressExists ? 0 : null,
                parsedCount: { used: 0, limit: 0, remaining: 0 },
              },
            },
          },
        }
      },

      buildCurrentEntries (_data, snapshotData) {
        const r = snapshotData.results.quota
        return {
          quota: {
            probeName: 'quota',
            sourceKind: 'private-dom',
            location: r.selector || '',
            httpStatus: 200,
            shape: r.shape || '',
            observedCount: r.observedCount || '',
            payload: r.data || {},
          },
        }
      },

      entryKey: 'quota',
      locationFn: (e) => e.selector || '',
    })

    return rows
  },
}
