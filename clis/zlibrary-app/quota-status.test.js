/**
 * Tests for the zlibrary-app quota-status command.
 *
 * Verifies the command returns correct field/value rows for:
 *   - DOM quota data (extracted from /users/downloads)
 *   - Ledger data (bootstrapped from DOM or loaded from disk)
 *
 * URL Security Boundary:
 *   - No URL fields in output rows (plain text field/value pairs)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getRegistry } from '@jackwener/opencli/registry'
import { createPageMock } from '../test-utils.js'

// Import to register the command
import './quota-status.js'

describe('zlibrary-app quota-status', () => {
  let tmpDir

  beforeEach(() => {
    // Set up isolated home directory for ledger file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-status-test-'))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  })

  it('shows DOM quota and bootstraps ledger when no existing ledger', async () => {
    const command = getRegistry().get('zlibrary-app/quota-status')

    const page = createPageMock([
      // window.location.origin
      'https://z-lib.fm',
      // window.location.href after navigation to /users/downloads
      'https://z-lib.fm/users/downloads',
      // DOM extraction result
      {
        countText: '3 / 10',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: true,
        progressAriaNow: 30,
      },
      // getCurrentHttpOrigin (called by getCurrentHttpOrigin inside
      // call to parseResetTextToAbsolute is pure, not part of evaluate)
    ])

    const rows = await command.func(page, {})

    // DOM section
    expect(rows).toContainEqual({ field: 'DOM Daily Used', value: '3' })
    expect(rows).toContainEqual({ field: 'DOM Daily Limit', value: '10' })
    expect(rows).toContainEqual({ field: 'DOM Daily Remaining', value: '7' })
    expect(rows).toContainEqual({ field: 'DOM Reset In', value: 'Downloads will be reset in 14h 5m' })
    expect(rows).toContainEqual({ field: 'DOM Usage (%)', value: '30%' })

    // Ledger section (bootstrapped from DOM — downloadedToday starts at 0
    // because it's a fresh ledger; DOM dailyUsed only feeds into getRemaining)
    expect(rows).toContainEqual({ field: 'Ledger Daily Limit', value: '10' })
    expect(rows).toContainEqual({ field: 'Ledger Downloaded Today', value: '0' })
    expect(rows).toContainEqual({ field: 'Ledger Remaining', value: '7' })
    expect(rows).toContainEqual({ field: 'Ledger Date', value: expect.any(String) })
  })

  it('shows DOM quota when DOM has null fields', async () => {
    const command = getRegistry().get('zlibrary-app/quota-status')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        countText: '',
        resetText: '',
        progressExists: false,
        progressAriaNow: null,
      },
    ])

    const rows = await command.func(page, {})

    // DOM section shows unknown
    expect(rows).toContainEqual({ field: 'DOM Daily Used', value: '(unknown)' })
    expect(rows).toContainEqual({ field: 'DOM Daily Limit', value: '(unknown)' })
    expect(rows).toContainEqual({ field: 'DOM Daily Remaining', value: '(unknown)' })

    // No DOM Reset In row when resetText is empty
    expect(rows.find(r => r.field === 'DOM Reset In')).toBeUndefined()

    // Ledger section shows unavailable
    expect(rows).toContainEqual({ field: 'Ledger', value: 'Not available (no ledger file)' })
  })

  it('shows ledger data when existing ledger is present', async () => {
    // Pre-write a ledger file
    const siteDir = path.join(tmpDir, '.opencli', 'sites', 'zlibrary-app')
    fs.mkdirSync(siteDir, { recursive: true })
    const ledgerData = {
      version: 1,
      date: '2026-06-06',
      dailyLimit: 10,
      downloadedToday: 5,
      resetAt: new Date(Date.now() + 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(
      path.join(siteDir, 'quota-ledger.json'),
      JSON.stringify(ledgerData),
      'utf-8',
    )

    const command = getRegistry().get('zlibrary-app/quota-status')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        countText: '8 / 10',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: true,
        progressAriaNow: 80,
      },
    ])

    const rows = await command.func(page, {})

    // Ledger shows persisted data (not DOM data)
    expect(rows).toContainEqual({ field: 'Ledger Daily Limit', value: '10' })
    expect(rows).toContainEqual({ field: 'Ledger Downloaded Today', value: '5' })
    expect(rows).toContainEqual({ field: 'Ledger Remaining', value: '2' })
    expect(rows).toContainEqual({ field: 'Ledger Date', value: '2026-06-06' })
    expect(rows).toContainEqual({ field: 'Ledger Reset At', value: ledgerData.resetAt })
    expect(rows).toContainEqual({ field: 'Ledger Updated At', value: ledgerData.updatedAt })
  })

  it('includes separator between DOM and ledger sections', async () => {
    const command = getRegistry().get('zlibrary-app/quota-status')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        countText: '1 / 10',
        resetText: '',
        progressExists: true,
        progressAriaNow: 10,
      },
    ])

    const rows = await command.func(page, {})
    expect(rows).toContainEqual({ field: '---', value: '---' })
  })
})
