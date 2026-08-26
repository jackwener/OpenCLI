/**
 * Snapshot Row Formats  -  universal 5-key output row helper.
 *
 * ALL doctor modes MUST use exactly these 5 keys. No format-specific keys.
 * The public CLI boundary always outputs the same 5-column shape.
 *
 * @module _shared/snapshot-rows
 */

export const DOCTOR_OUTPUT_COLUMNS = ['probe', 'status', 'count', 'sampleValue', 'message']

/**
 * Build a single doctor output row with exactly 5 keys.
 *
 * @param {object} fields
 * @param {string} fields.probe  -  Stable probe identifier
 * @param {string} [fields.status='']  -  pass | warn | fail | na
 * @param {number|string} [fields.count='']  -  Primary observed count (1/0, results length, etc.)
 * @param {*} [fields.sampleValue='']  -  Representative sample value (text, shape, title)
 * @param {string} [fields.message='']  -  Human-readable context message
 * @returns {{ probe: string, status: string, count: string, sampleValue: *, message: string }}
 */
export function doctorRow (fields) {
  var _a = fields || {}
  var probe = _a.probe, status = _a.status, count = _a.count, sampleValue = _a.sampleValue, message = _a.message
  return {
    probe: probe || '',
    status: status || '',
    count: String(count ?? ''),
    sampleValue: sampleValue ?? '',
    message: message || '',
  }
}

/**
 * Build a navigation status row.
 *
 * probe = '{modeName}-navigation', status/message from caller, count/sampleValue empty.
 *
 * @param {string} modeName - Doctor mode name (e.g. 'quota', 'profile', 'search')
 * @param {string} status
 * @param {string} message
 * @returns {{ probe: string, status: string, count: string, sampleValue: string, message: string }}
 */
export function doctorNavRow (modeName, status, message) {
  return doctorRow({
    probe: modeName ? modeName + '-navigation' : '',
    status: status || '',
    count: '',
    sampleValue: '',
    message: message || '',
  })
}
