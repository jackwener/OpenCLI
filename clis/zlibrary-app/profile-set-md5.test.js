/**
 * Tests for the zlibrary-app profile-set-md5 command.
 *
 * Verifies the command:
 *   - Returns already_enabled when MD5 format is already set
 *   - Successfully updates the format via POST to /eapi/user/update
 *   - Verifies the change was applied by re-reading /users/downloads
 *   - Handles POST failures and verification failures
 *   - Handles not logged in / invalid origin
 *
 * URL Security Boundary:
 *   - Internal: relative URLs only (/users/downloads, /profileEdit/others, /eapi/user/update)
 *   - Output: plain text field/value pairs (no URLs in output)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getRegistry } from '@jackwener/opencli/registry'
import { createPageMock } from '../test-utils.js'
import { CommandExecutionError, LoginWallError } from '@jackwener/opencli/errors'

// Mock pid-lock to avoid filesystem side effects
vi.mock('./_shared/infra/pid-lock.js', () => ({
  acquireLockOrThrow: vi.fn().mockResolvedValue({ release: vi.fn() })
}))

// Import to register the command
import './profile-set-md5.js'

describe('zlibrary-app profile-set-md5', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-set-md5-test-'))
    process.env.HOME = tmpDir
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  })

  it('returns already_enabled when MD5 format is already set', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      // window.location.origin
      'https://z-lib.fm',
      // window.location.href after navigation to /users/downloads
      'https://z-lib.fm/users/downloads',
      // DOM extraction result - MD5 already enabled
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a)_MD5_%m_',
      },
    ])

    const rows = await command.func(page, {})

    expect(rows).toContainEqual({ field: 'Status', value: 'already_enabled' })
    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'enabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '%t (%a)_MD5_%m_' })
    expect(rows).toContainEqual({ field: 'Target Format', value: '{Title} ({Author})_MD5_{md5}_' })

    // Should NOT have navigated to /profileEdit/others or made POST
    expect(page.goto).toHaveBeenCalledTimes(1) // Only /users/downloads (inside extractQuotaFromDom)
    expect(page.evaluate).toHaveBeenCalledTimes(3) // extractQuotaFromDom: getCurrentHttpOrigin + assertSameOrigin + DOM extraction
  })

  it('successfully updates MD5 format and verifies', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      // First extractQuotaFromDom call - MD5 disabled
      'https://z-lib.fm',                                    // window.location.origin
      'https://z-lib.fm/users/downloads',                    // window.location.href
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a).%e', // No MD5
      },
      // Navigation to /profileEdit/others
      'https://z-lib.fm',                                    // window.location.origin for referrer page
      'https://z-lib.fm/profileEdit/others',                 // window.location.href after goto
      // POST fetch result
      { ok: true, status: 200, text: 'OK' },
      // Second extractQuotaFromDom call - verification
      'https://z-lib.fm',                                    // window.location.origin
      'https://z-lib.fm/users/downloads',                    // window.location.href
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a)_MD5_%m_', // Now enabled
      },
    ])

    const rows = await command.func(page, {})

    expect(rows).toContainEqual({ field: 'Status', value: 'updated' })
    expect(rows).toContainEqual({ field: 'MD5 Filename Format', value: 'enabled' })
    expect(rows).toContainEqual({ field: 'Filename Format', value: '%t (%a)_MD5_%m_' })
    expect(rows).toContainEqual({ field: 'Target Format', value: '{Title} ({Author})_MD5_{md5}_' })

    // Should have navigated to /users/downloads twice and /profileEdit/others once
    expect(page.goto).toHaveBeenCalledTimes(3)
    // Check the POST evaluate was called with correct URL
    const evaluateCalls = page.evaluate.mock.calls
    const postCall = evaluateCalls.find(call => String(call[0]).includes('eapi/user/update'))
    expect(postCall).toBeDefined()
    expect(String(postCall[0])).toContain('POST')
    expect(String(postCall[0])).toContain('credentials: \'include\'')
  })

  it('throws CommandExecutionError when POST fails', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a).%e',
      },
      'https://z-lib.fm',
      'https://z-lib.fm/profileEdit/others',
      { ok: false, status: 400, text: 'Bad Request' }, // POST fails
    ])

    const promise = command.func(page, {})
    await expect(promise).rejects.toBeInstanceOf(CommandExecutionError)
    await expect(promise).rejects.toThrow(/Failed to update MD5 filename format/)
  })

  it('throws CommandExecutionError when verification fails', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a).%e',
      },
      'https://z-lib.fm',
      'https://z-lib.fm/profileEdit/others',
      { ok: true, status: 200, text: 'OK' },
      // Verification - still disabled
      'https://z-lib.fm',
      'https://z-lib.fm/users/downloads',
      {
        dailyUsed: 3,
        dailyLimit: 10,
        dailyRemaining: 7,
        resetText: 'Downloads will be reset in 14h 5m',
        progressAriaNow: 30,
        filenameFormatText: '%t (%a).%e', // Still no MD5
      },
    ])

    const promise = command.func(page, {})
    await expect(promise).rejects.toBeInstanceOf(CommandExecutionError)
    await expect(promise).rejects.toThrow(/Failed to verify MD5 filename format was applied/)
  })

  it('throws when not logged in (login wall on /users/downloads)', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      'https://z-lib.fm',
      'https://z-lib.fm/login', // Redirected to login
      {
        dailyUsed: null,
        dailyLimit: null,
        dailyRemaining: null,
        resetText: '',
        progressAriaNow: null,
        filenameFormatText: '',
      },
    ])

    // extractQuotaFromDom → assertSameOriginNotLoginWall detects /login → throws LoginWallError
    await expect(command.func(page, {})).rejects.toBeInstanceOf(LoginWallError)
  })

  it('throws when origin is invalid (file://)', async () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')

    const page = createPageMock([
      'file:///app/index.html', // Invalid origin
    ])

    await expect(command.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError)
    await expect(command.func(page, {})).rejects.toThrow(/Not connected to a Z-Library page/)
  })

  it('registers with correct name and access', () => {
    const command = getRegistry().get('zlibrary-app/profile-set-md5')
    expect(command).toBeDefined()
    expect(command.name).toBe('profile-set-md5')
    expect(command.access).toBe('write')
    expect(command.site).toBe('zlibrary-app')
    expect(command.columns).toEqual(['field', 'value'])
  })
})
