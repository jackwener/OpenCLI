/**
 * Tests for download-fixture-set module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadDownloadFixtureSet } from '../fixture/loader.js'
import { createSuccessFixture, create403Fixture, create204GateFixture } from '../fixture/test/traces.js'

describe('download-fixture-set', function () {
  /** @type {string} */
  var tmpDir

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-fixture-test-'))
  })

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ----- Success path -----

  it('loads valid fixture files from directory', function () {
    var trace = createSuccessFixture()
    fs.writeFileSync(path.join(tmpDir, 'success.fixture.json'), JSON.stringify(trace))

    var result = loadDownloadFixtureSet({ dir: tmpDir })
    expect(result.stats.totalFiles).toBe(1)
    expect(result.stats.validCount).toBe(1)
    expect(result.stats.invalidCount).toBe(0)
    expect(result.valid[0].file).toBe('success.fixture.json')
  })

  it('loads multiple valid fixtures', function () {
    fs.writeFileSync(path.join(tmpDir, 'a.fixture.json'), JSON.stringify(createSuccessFixture()))
    fs.writeFileSync(path.join(tmpDir, 'b.fixture.json'), JSON.stringify(create403Fixture()))
    fs.writeFileSync(path.join(tmpDir, 'c.fixture.json'), JSON.stringify(create204GateFixture()))

    var result = loadDownloadFixtureSet({ dir: tmpDir })
    expect(result.stats.totalFiles).toBe(3)
    expect(result.stats.validCount).toBe(3)
    expect(result.stats.invalidCount).toBe(0)
  })

  it('only loads files matching filePattern', function () {
    fs.writeFileSync(path.join(tmpDir, 'a.fixture.json'), JSON.stringify(createSuccessFixture()))
    fs.writeFileSync(path.join(tmpDir, 'b.json'), JSON.stringify(create403Fixture()))
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), 'hello')

    var result = loadDownloadFixtureSet({ dir: tmpDir })
    expect(result.stats.totalFiles).toBe(1)
    expect(result.stats.validCount).toBe(1)
    expect(result.valid[0].file).toBe('a.fixture.json')
  })

  // ----- Error paths -----

  it('returns FIXTURE_DIR_MISSING for empty dir', function () {
    var result = loadDownloadFixtureSet({ dir: '' })
    expect(result.stats.totalFiles).toBe(0)
    expect(result.invalid[0].code).toBe('FIXTURE_DIR_MISSING')
  })

  it('returns FIXTURE_DIR_MISSING for non-existent dir', function () {
    var result = loadDownloadFixtureSet({ dir: '/tmp/nonexistent-dir-12345' })
    expect(result.stats.totalFiles).toBe(0)
    expect(result.invalid[0].code).toBe('FIXTURE_DIR_MISSING')
  })

  it('returns FIXTURE_PARSE_ERROR for unparseable JSON', function () {
    fs.writeFileSync(path.join(tmpDir, 'bad.fixture.json'), 'not json {{{')

    var result = loadDownloadFixtureSet({ dir: tmpDir })
    expect(result.stats.invalidCount).toBe(1)
    expect(result.invalid[0].code).toBe('FIXTURE_PARSE_ERROR')
  })

  it('returns FIXTURE_SCHEMA_REJECT for invalid trace', function () {
    fs.writeFileSync(path.join(tmpDir, 'bad.fixture.json'), JSON.stringify({ notATrace: true }))

    var result = loadDownloadFixtureSet({ dir: tmpDir })
    expect(result.stats.invalidCount).toBe(1)
    expect(result.invalid[0].code).toBe('FIXTURE_SCHEMA_REJECT')
  })
})
