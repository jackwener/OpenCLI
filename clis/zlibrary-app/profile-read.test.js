/**
 * Tests for the zlibrary-app profile-read command.
 *
 * Verifies the command returns correct field/value rows for:
 *   - Account info (username, account tier, filename format from /profileEdit)
 *   - DOM quota data (extracted from /users/downloads)
 *   - Ledger data (bootstrapped from DOM or loaded from disk)
 *   - MD5 Filename Format status (enabled/disabled)
 *   - Raw Filename Format text
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
import profileFixture from './fixture/profile-default.json'
import quotaFixture from './fixture/quota-default.json'

// Mock pid-lock to avoid filesystem side effects
vi.mock('./_shared/infra/pid-lock.js', () => ({
  acquireLockOrThrow: vi.fn().mockResolvedValue({ release: vi.fn() })
}))

// Import to register the command
import './profile-read.js'

describe('zlibrary-app profile-read', () => {
  const ORIGIN = 'https://z-lib.fm'
  const QUOTA_HREF = 'https://z-lib.fm/users/downloads'
  const PROFILE_HREF = 'https://z-lib.fm/profileEdit'
  const profileFixtureData = profileFixture.results['profile-selectors'].data
  const quotaFixtureData = quotaFixture.results.quota.data

  let tmpDir

  beforeEach(() => {
    // Set up isolated home directory for ledger file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-read-test-'))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  })

  it('uses saved doctor fixtures for profile and quota read action', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      ORIGIN,
      QUOTA_HREF,
      quotaFixtureData,
      ORIGIN,
      PROFILE_HREF,
      profileFixtureData,
    ])

    const rows = await command.func(page, {})

    expect(rows).toContainEqual({ field: 'Username', value: '[REDACTED]' })
    expect(rows).toContainEqual({ field: 'Account Tier', value: '[REDACTED]' })
    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'enabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: profileFixtureData.filenameFormat })
    expect(rows).toContainEqual({ field: 'Daily Used', value: '0' })
    expect(rows).toContainEqual({ field: 'Daily Limit', value: '0' })
    expect(rows).toContainEqual({ field: 'Daily Remaining', value: '0' })
  })

  it('extractProfileSnapshotFromDom returns fixture-shaped profile payload', async () => {
    const { extractProfileSnapshotFromDom } = await import('./profile-read.js')

    const page = createPageMock([
      ORIGIN,
      PROFILE_HREF,
      profileFixtureData,
    ])

    const result = await extractProfileSnapshotFromDom(page)

    expect(result).toEqual(profileFixtureData)
  })

  it('shows account info, DOM quota, MD5 status, and bootstraps ledger', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates: origin, href, DOM)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '3 / 10',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: true,
        progressAriaNow: 30,
        filenameFormatText: '',
      },
      // Path 2: extractProfileFromDom (3 evaluates: origin, href, DOM)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Premium account', filenameFormat: '{title} ({author})_MD5_{md5}_' },
    ])

    const rows = await command.func(page, {})

    // Account section
    expect(rows).toContainEqual({ field: 'Username', value: 'testuser' })
    expect(rows).toContainEqual({ field: 'Account Tier', value: 'Premium account' })

    // MD5 Filename Format section (after account, before quota)
    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'enabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '{title} ({author})_MD5_{md5}_' })

    // Quota section
    expect(rows).toContainEqual({ field: 'Daily Used', value: '3' })
    expect(rows).toContainEqual({ field: 'Daily Limit', value: '10' })
    expect(rows).toContainEqual({ field: 'Daily Remaining', value: '7' })
    expect(rows).toContainEqual({ field: 'Reset In', value: 'Downloads will be reset in 14h 5m' })
    expect(rows).toContainEqual({ field: 'Usage (%)', value: '30%' })

    // Ledger section (bootstrapped from DOM)
    expect(rows).toContainEqual({ field: 'Ledger Daily Limit', value: '10' })
    expect(rows).toContainEqual({ field: 'Ledger Downloaded Today', value: '0' })
    expect(rows).toContainEqual({ field: 'Ledger Remaining', value: '7' })
    expect(rows).toContainEqual({ field: 'Ledger Date', value: expect.any(String) })
  })

  it('shows MD5 Filename Format as disabled when format does not contain MD5', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '3 / 10',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: true,
        progressAriaNow: 30,
        filenameFormatText: '',
      },
      // Path 2: extractProfileFromDom (3 evaluates, includes filenameFormat)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Basic account', filenameFormat: '{title} ({author}).{extension}' },
    ])

    const rows = await command.func(page, {})

    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'disabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '{title} ({author}).{extension}' })
  })

  it('shows Filename Format as (not found) when DOM element missing', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: false,
        progressAriaNow: null,
        filenameFormatText: '', // Empty
      },
      // Path 2: extractProfileFromDom (3 evaluates, filenameFormat empty)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Basic account', filenameFormat: '' },
    ])

    const rows = await command.func(page, {})

    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'disabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '(not found)' })
  })

  it('shows DOM quota when DOM has null fields', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '',
        resetText: '',
        progressExists: false,
        progressAriaNow: null,
        filenameFormatText: '',
      },
      // Path 2: extractProfileFromDom (3 evaluates, filenameFormat from profile)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Basic account', filenameFormat: '{title} ({author})_MD5_{md5}_' },
    ])

    const rows = await command.func(page, {})

    // DOM section shows unknown
    expect(rows).toContainEqual({ field: 'Daily Quota', value: 'Unknown (DOM not found)' })

    // MD5 status still works
    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'enabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '{title} ({author})_MD5_{md5}_' })

    // No DOM Reset In row when resetText is empty
    expect(rows.find(r => r.field === 'Reset In')).toBeUndefined()

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

    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '8 / 10',
        resetText: 'Downloads will be reset in 14h 5m',
        progressExists: true,
        progressAriaNow: 80,
        filenameFormatText: '',
      },
      // Path 2: extractProfileFromDom (3 evaluates, includes filenameFormat)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Premium account', filenameFormat: '{title} ({author})_MD5_{md5}_' },
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

  it('includes separator between account/MD5 and quota sections', async () => {
    const command = getRegistry().get('zlibrary-app/profile-read')

    const page = createPageMock([
      // Path 1: extractQuotaFromDom (3 evaluates)
      ORIGIN,
      QUOTA_HREF,
      {
        countText: '1 / 10',
        resetText: '',
        progressExists: true,
        progressAriaNow: 10,
        filenameFormatText: '',
      },
      // Path 2: extractProfileFromDom (3 evaluates)
      ORIGIN,
      PROFILE_HREF,
      { username: 'testuser', accountTier: 'Basic account', filenameFormat: '{title} ({author})_MD5_{md5}_' },
    ])

    const rows = await command.func(page, {})
    expect(rows).toContainEqual({ field: '---', value: '---' })
  })

  it('registers with correct name and access', () => {
    const command = getRegistry().get('zlibrary-app/profile-read')
    expect(command).toBeDefined()
    expect(command.name).toBe('profile-read')
    expect(command.access).toBe('read')
    expect(command.site).toBe('zlibrary-app')
    expect(command.columns).toEqual(['field', 'value'])
  })
})
