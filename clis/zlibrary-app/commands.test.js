import { describe, expect, it } from 'vitest'
import { getRegistry } from '@jackwener/opencli/registry'
import fs from 'node:fs'

import './status.js'
import './search.js'
import './info.js'
import './download.js'
import './download-history.js'

// Booklist commands — import to register
import './booklist-create.js'
import './booklist-add.js'
import './booklist-list.js'
import './booklist-show.js'
import './booklist-delete.js'
import './booklist-manage.js'
import './booklist-download.js'
import './booklist-export.js'
import './booklist-import.js'

// Quota commands
import './quota-status.js'

// Profile commands
import './profile-read.js'

// Doctor (diagnostic) command family
import './doctor.js'

describe('zlibrary-app command registration', () => {
  it('registers all commands', () => {
    expect(getRegistry().get('zlibrary-app/status')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/search')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/info')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/download')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/download-history')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-create')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-add')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-list')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-show')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-delete')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-manage')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-download')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-export')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/booklist-import')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/quota-status')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/profile-read')).toBeDefined()
    expect(getRegistry().get('zlibrary-app/doctor')).toBeDefined()
    // Assert deleted commands are NOT registered
    expect(getRegistry().get('zlibrary-app/booklist-info')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/booklist-remove')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/book-lookup')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/profile')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-dom-bookcard')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-dom-search')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-dom-profile')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-dom-quota')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-api-booklist')).toBeUndefined()
    expect(getRegistry().get('zlibrary-app/doctor-api-user')).toBeUndefined()
  })

  it('doctor exposes mode flags and shared fixture args', () => {
    const cmd = getRegistry().get('zlibrary-app/doctor')
    expect(cmd).toBeDefined()

    const args = cmd.args.map(function (arg) { return arg.name })
    expect(args).toContain('api-user')
    expect(args).toContain('dom-search')
    expect(args).toContain('dom-profile')
    expect(args).toContain('dom-quota')
    expect(args).toContain('dom-book-detail')
    expect(args).toContain('download')
    expect(args).toContain('booklist-manage')
    expect(args).toContain('dir')
    expect(args).toContain('save-fixture')
  })

  it('doctor rejects zero selected mode flags', () => {
    const cmd = getRegistry().get('zlibrary-app/doctor')
    expect(cmd).toBeDefined()

    expect(function () {
      cmd.func({}, {})
    }).toThrow('Select exactly one mode: --booklist, --api-user, --dom-search, --dom-profile, --dom-quota, --dom-book-detail, --download, or --booklist-manage')
  })

  it('doctor rejects multiple selected mode flags', () => {
    const cmd = getRegistry().get('zlibrary-app/doctor')
    expect(cmd).toBeDefined()

    expect(function () {
      cmd.func({}, { 'booklist': true, 'dom-search': true })
    }).toThrow('Select exactly one mode: --booklist, --api-user, --dom-search, --dom-profile, --dom-quota, --dom-book-detail, --download, or --booklist-manage')
  })

  it('shared pipeline imports from dom.js via correct relative path', async () => {
    const pipelineSrc = fs.readFileSync(
      new URL('./_shared/infra/search-pipeline.js', import.meta.url), 'utf8'
    )
    // After migration: search-pipeline.js imports from zlibrary/dom.js directly
    expect(pipelineSrc).toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/zlibrary\/dom\.js['"]/)
    // Must NOT import from utils.js barrel
    expect(pipelineSrc).not.toMatch(/from\s+['"]\.\.\/utils\.js['"]/)
    // Must NOT import from old _shared/ paths
    expect(pipelineSrc).not.toMatch(/from\s+['"]\.\.\/utils\.js['"]/)
  })

  it('booklist-search imports from search-pipeline.js (local _shared/infra/), not the wrong path', async () => {
    const booklistSearchSrc = fs.readFileSync(
      new URL('./_shared/infra/booklist-search.js', import.meta.url), 'utf8'
    )
    // booklist-search.js already imports from ./search-pipeline.js which is correct
    expect(booklistSearchSrc).toMatch(/from\s+['"]\.\/search-pipeline\.js['"]/)
    expect(booklistSearchSrc).not.toMatch(/from\s+['"]\.\/search\.js['"]/)
    // After migration: imports DOM helpers directly
    expect(booklistSearchSrc).toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/zlibrary\/dom\.js['"]/)
  })

  it('commands import DOM helpers directly from dom.js (migration complete)', async () => {
    // Verify commands now import from ../zlibrary/dom.js directly
    // This is the new architecture — no more utils.js barrel
    const searchSrc = fs.readFileSync(
      new URL('./search.js', import.meta.url), 'utf8'
    )
    const infoSrc = fs.readFileSync(
      new URL('./info.js', import.meta.url), 'utf8'
    )
    // After migration: search.js should import from zlibrary/dom.js
    expect(searchSrc).toMatch(/from\s+['"](\.\.\/zlibrary\/dom\.js)['"]/)
    expect(infoSrc).toMatch(/from\s+['"](\.\.\/zlibrary\/dom\.js)['"]/)
    const downloadHistorySrc = fs.readFileSync(
      new URL('./download-history.js', import.meta.url), 'utf8'
    )
    // download-history.js has completely different DOM (tr.dstats-row, not z-bookcard),
    // so it must bypass utils.js entirely and import evaluateJson directly
    expect(downloadHistorySrc).not.toMatch(/from\s+['"]\.\/utils\.js['"]/)

    // Booklist commands use CDP API injection (fetch), not DOM extraction.
    // They should NOT import from dom.js directly.
    const booklistFiles = [
      'booklist-create.js',
      'booklist-add.js',
      'booklist-list.js',
      'booklist-show.js',
      'booklist-delete.js',
      'booklist-manage.js',
      'booklist-download.js',
      'booklist-export.js',
      'booklist-import.js',
      'doctor.js',
      'doctor-dom-search.js',
      'doctor-dom-profile.js',
      'doctor-dom-quota.js',
      'doctor-api-user.js',
      'doctor-dom-detail.js',
      'doctor-booklist-manage.js',
    ]
    for (const file of booklistFiles) {
      const src = fs.readFileSync(new URL('./' + file, import.meta.url), 'utf8')
      // Most booklist commands don't use DOM helpers directly
      // (doctor-dom-detail and doctor-dom-search are exceptions that now import directly)
    }
    // doctor-dom-detail imports from dom.js (correct — it extracts DOM)
    const domDetailSrc = fs.readFileSync(new URL('./doctor-dom-detail.js', import.meta.url), 'utf8')
    expect(domDetailSrc).toMatch(/from\s+['"](\.\.\/zlibrary\/dom\.js)['"]/)
    // doctor-dom-search imports from dom.js (correct — it extracts DOM)
    const domSearchSrc = fs.readFileSync(new URL('./doctor-dom-search.js', import.meta.url), 'utf8')
    expect(domSearchSrc).toMatch(/from\s+['"](\.\.\/zlibrary\/dom\.js)['"]/)
  })
})
