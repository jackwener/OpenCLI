/**
 * Z-Library App doctor --booklist-manage mode.
 *
 * Reads local booklist-manage mutation trace fixture files from
 * `booklist-manage --fixture` output. Pure local fixture reader:
 * no network, no browser navigation, no replay.
 *
 * Output columns (universal 5-key): probe | status | count | sampleValue | message
 */
import fs from 'node:fs'
import path from 'node:path'
import { doctorRow } from './_shared/snapshot/rows.js'

function makeManageProbeName(suffix) {
  return 'manage-' + suffix
}

export async function runDoctorBooklistManage(kwargs) {
  const rows = []
  const dir = String(kwargs.dir || '').trim()
  if (!dir) {
    rows.push(doctorRow({ probe: makeManageProbeName('fixture-dir'), status: 'fail', count: 0, sampleValue: '', message: '--dir is required' }))
    return rows
  }

  const fixtureDir = path.resolve(dir)
  const fixtureBase = path.basename(fixtureDir)
  let files = []
  try {
    const dirents = fs.readdirSync(fixtureDir, { withFileTypes: true })
    files = dirents
      .filter(function (d) { return d.isFile() && d.name.endsWith('.manage.fixture.json') })
      .map(function (d) { return d.name })
      .sort()
  } catch (err) {
    rows.push(doctorRow({ probe: makeManageProbeName('fixture-dir'), status: 'fail', count: 0, sampleValue: fixtureBase, message: 'Cannot read directory: ' + err.message }))
    return rows
  }

  if (files.length === 0) {
    rows.push(doctorRow({ probe: makeManageProbeName('fixture-dir'), status: 'fail', count: 0, sampleValue: fixtureBase, message: 'No *.manage.fixture.json files found' }))
    return rows
  }

  rows.push(doctorRow({ probe: makeManageProbeName('fixture-dir'), status: 'pass', count: files.length, sampleValue: fixtureBase, message: 'Found ' + files.length + ' fixture(s)' }))

  for (let i = 0; i < files.length; i++) {
    const filepath = path.join(fixtureDir, files[i])
    let fixture = null
    try {
      const raw = fs.readFileSync(filepath, 'utf-8')
      fixture = JSON.parse(raw)
    } catch (err) {
      rows.push(doctorRow({ probe: makeManageProbeName('fixture-parse-error'), status: 'fail', count: 1, sampleValue: files[i], message: 'Parse error: ' + err.message }))
      continue
    }

    if (!fixture.fixtureKind || fixture.fixtureKind !== 'zlibrary-app.booklist-manage.mutation-trace') {
      rows.push(doctorRow({ probe: makeManageProbeName('fixture-schema-reject'), status: 'fail', count: 1, sampleValue: files[i], message: 'Unknown fixtureKind: ' + (fixture.fixtureKind || '(missing)') }))
      continue
    }

    const operation = fixture.operation || '?'
    const label = operation + ' @ ' + files[i]

    let assertionPass = 0
    let assertionFail = 0
    if (Array.isArray(fixture.assertions)) {
      for (let a = 0; a < fixture.assertions.length; a++) {
        const asn = fixture.assertions[a]
        const asnStatus = asn.status === 'pass' ? 'pass' : 'fail'
        rows.push(doctorRow({ probe: makeManageProbeName('api-shape'), status: asnStatus, count: 1, sampleValue: label, message: asn.name + ': ' + asn.message }))
        if (asn.status === 'pass') assertionPass++
        else assertionFail++
      }
    }

    var lookupFailed = false
    if (Array.isArray(fixture.phases)) {
      for (let p = 0; p < fixture.phases.length; p++) {
        const phase = fixture.phases[p]
        if (phase.kind === 'api') {
          const httpOk = phase.response && phase.response.httpStatus >= 200 && phase.response.httpStatus < 300
          rows.push(doctorRow({
            probe: makeManageProbeName('api-status'),
            status: httpOk ? 'pass' : 'fail',
            count: 1,
            sampleValue: label,
            message: phase.name + ' HTTP ' + (phase.response ? phase.response.httpStatus : '?'),
          }))
          // Track lookup failure (resolveReadlistBookId returned 0 matches)
          if (phase.name === 'resolveReadlistBookId' && phase.response && phase.response.body && phase.response.body.matched === 0) {
            lookupFailed = true
          }
        } else if (phase.kind === 'dom') {
          const state = phase.state || {}
          const hasErrors = Array.isArray(state.errors) && state.errors.length > 0
          if (hasErrors) {
            rows.push(doctorRow({ probe: makeManageProbeName('dom-visible-error'), status: 'fail', count: state.errors.length, sampleValue: label, message: state.errors.join('; ') }))
          } else {
            rows.push(doctorRow({ probe: makeManageProbeName('dom-visible-error'), status: 'pass', count: 0, sampleValue: label, message: 'no DOM errors' }))
          }

          if (lookupFailed && operation === 'delete-book-id') {
            // Lookup failed before mutation — emit separate probe instead of dom-target-present
            rows.push(doctorRow({
              probe: makeManageProbeName('lookup-failure'),
              status: 'fail',
              count: 1,
              sampleValue: label,
              message: 'book not found in booklist (resolveReadlistBookId returned 0 matches)',
            }))
          } else {
            const targetPresent = Boolean(state.targetBookPresent)
            const expectedAfterOp = operation === 'delete-book-id' ? false : true
            const domOk = targetPresent === expectedAfterOp
            rows.push(doctorRow({
              probe: makeManageProbeName('dom-target-present'),
              status: domOk ? 'pass' : 'fail',
              count: 1,
              sampleValue: label,
              message: 'targetBookPresent=' + targetPresent + ' (expected=' + expectedAfterOp + ')',
            }))
          }
        }
      }
    }

    // Classification: api_failed_dom_passed (addBook API fails but DOM confirms target present)
    if (operation === 'add-book-id' && Array.isArray(fixture.phases)) {
      let apiFailed = false
      let domPresent = false
      let failReason = '?'
      for (let p = 0; p < fixture.phases.length; p++) {
        const phase = fixture.phases[p]
        if (phase.kind === 'api' && phase.name === 'addBook') {
          const httpOk = phase.response && phase.response.httpStatus >= 200 && phase.response.httpStatus < 300
          if (!httpOk || phase.error) {
            apiFailed = true
            failReason = phase.response ? 'HTTP ' + phase.response.httpStatus : (phase.error || 'error')
          }
        }
        if (phase.kind === 'dom' && phase.state && phase.state.targetBookPresent === true) {
          domPresent = true
        }
      }
      if (apiFailed && domPresent) {
        rows.push(doctorRow({
          probe: makeManageProbeName('api-fail-dom-pass'),
          status: 'info',
          count: 1,
          sampleValue: label,
          message: 'api_failed_dom_passed: ' + failReason,
        }))
      }
    }

    const totalAssertions = assertionPass + assertionFail
    const verdict = assertionFail === 0 ? 'pass' : 'fail'
    rows.push(doctorRow({ probe: makeManageProbeName('mutation-verdict'), status: verdict, count: totalAssertions, sampleValue: label, message: assertionFail + '/' + totalAssertions + ' assertions failed' }))
  }

  return rows
}
