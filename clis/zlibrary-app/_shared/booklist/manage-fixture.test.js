/**
 * ManageMutationTraceRecorder unit tests.
 */
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { ManageMutationTraceRecorder, buildManageFixtureFilename } from '../fixture/manage-recorder.js'
import { sanitiseFixtureId } from '../fixture/output.js'

describe('ManageMutationTraceRecorder', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'manage-fixture-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null when disabled', () => {
    const r = new ManageMutationTraceRecorder({ enabled: false, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordApiPhase('test', { method: 'GET', url: '/api/test', httpStatus: 200, body: { ok: true }, elapsedMs: 100 })
    const result = r.save()
    expect(result).toBe(null)
  })

  it('records API phase and assertion', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.setBooklist({ id: 42, title: 'test' })
    r.recordApiPhase('addBook', { method: 'GET', url: '/papi/booklist/42/add-book/123', httpStatus: 200, body: { success: true }, elapsedMs: 300 })
    r.recordAssertion('api-response-shape', 'pass', 'response has readlistBookId')

    const filepath = r.save()
    expect(filepath).toBeTruthy()
    expect(filepath.endsWith('.manage.fixture.json')).toBe(true)
    expect(path.basename(filepath).startsWith('booklist-manage-add-book-id-')).toBe(true)
    expect(filepath.startsWith(tmpDir)).toBe(true)

    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.schemaVersion).toBe(1)
    expect(saved.fixtureKind).toBe('zlibrary-app.booklist-manage.mutation-trace')
    expect(saved.operation).toBe('add-book-id')
    expect(saved.input.booklistName).toBe('test')
    expect(saved.input.bookId).toBe('123')
    expect(saved.booklist).toEqual({ id: 42, title: 'test' })
    expect(saved.phases.length).toBe(1)
    expect(saved.phases[0].kind).toBe('api')
    expect(saved.phases[0].name).toBe('addBook')
    expect(saved.phases[0].response.httpStatus).toBe(200)
    expect(saved.assertions.length).toBe(1)
    expect(saved.assertions[0].name).toBe('api-response-shape')
    expect(saved.assertions[0].status).toBe('pass')
    expect(typeof saved.elapsedMs).toBe('number')
  })

  it('records DOM phase', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordDomPhase('afterMutationDom', {
      urlOrigin: 'https://z-lib.sk',
      urlPath: '/booklist/42',
      targetBookId: '123',
      targetBookPresent: true,
      visibleTexts: ['Book added', 'test'],
      bookcardsCount: 5,
      errors: [],
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.phases.length).toBe(1)
    expect(saved.phases[0].kind).toBe('dom')
    expect(saved.phases[0].state.targetBookPresent).toBe(true)
    expect(saved.phases[0].state.bookcardsCount).toBe(5)
    expect(saved.phases[0].state.visibleTexts.length).toBe(2)
    expect(saved.phases[0].state.errors.length).toBe(0)
  })

  it('stores urlOrigin and urlPath instead of currentUrl', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordDomPhase('afterMutationDom', {
      urlOrigin: 'https://z-lib.sk',
      urlPath: '/booklist/42',
      targetBookId: '123',
      targetBookPresent: true,
      visibleTexts: [],
      bookcardsCount: 0,
      errors: [],
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.phases[0].state.urlOrigin).toBe('https://z-lib.sk')
    expect(saved.phases[0].state.urlPath).toBe('/booklist/42')
    expect(saved.phases[0].state.currentUrl).toBeUndefined()
  })

  it('records DOM phase with htmlSnapshot on assertion failure', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordDomPhase('afterMutationDom', {
      targetBookPresent: false,
      errors: ['book not found'],
      htmlSnapshot: '<!DOCTYPE html><html><body>test</body></html>',
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.phases[0].kind).toBe('dom')
    expect(saved.phases[0].htmlSnapshot).toBeTruthy()
    expect(saved.phases[0].htmlSnapshot).toBe('<!DOCTYPE html><html><body>test</body></html>')
  })

  it('records structured error', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.setError({ phase: 'resolveBooklist', type: 'CommandExecutionError', message: 'Booklist not found' })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.error).toBeTruthy()
    expect(saved.error.phase).toBe('resolveBooklist')
    expect(saved.error.type).toBe('CommandExecutionError')
    expect(saved.error.message).toBe('Booklist not found')
  })

  it('sanitizes bookId in filename (path traversal prevention)', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '../../../etc', fixtureDir: tmpDir })
    const filepath = r.save()
    expect(filepath).toBeTruthy()
    // Sanitized ID should have dots/slashes replaced
    expect(filepath.includes('..')).toBe(false)
    expect(filepath.includes('/etc')).toBe(false)
  })

  it('buildManageFixtureFilename sanitizes bookId', () => {
    const name = buildManageFixtureFilename('add-book-id', '../../../etc/passwd')
    expect(name.startsWith('booklist-manage-add-book-id-')).toBe(true)
    expect(name.includes('..')).toBe(false)
    expect(name.includes('/')).toBe(false)
  })

  it('handles DOM phase with empty state gracefully', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordDomPhase('afterMutationDom', {})

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.phases.length).toBe(1)
    expect(saved.phases[0].state.targetBookPresent).toBe(false)
    expect(saved.phases[0].state.visibleTexts.length).toBe(0)
    expect(saved.phases[0].state.bookcardsCount).toBe(0)
    expect(saved.phases[0].state.errors.length).toBe(0)
  })

  it('persists fixtureKind and schemaVersion in saved file', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'delete-book-id', booklistName: 'test', bookId: '999', fixtureDir: tmpDir })
    r.recordApiPhase('removeBook', { method: 'GET', url: '/api/remove', httpStatus: 200, body: { success: true }, elapsedMs: 200 })
    r.recordAssertion('api-response-shape', 'pass', 'remove succeeded')

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    expect(saved.fixtureKind).toBe('zlibrary-app.booklist-manage.mutation-trace')
    expect(saved.schemaVersion).toBe(1)
    expect(saved.operation).toBe('delete-book-id')
    expect(saved.input.bookId).toBe('999')
  })

  it('stores raw response body — sensitive fields preserved (write-action fixture)', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'add-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.setBooklist({ id: 42, title: 'test' })
    r.recordApiPhase('addBook', {
      method: 'GET',
      url: '/papi/booklist/42/add-book/123',
      httpStatus: 200,
      body: {
        success: true,
        readlistBookId: '789',
        bookId: '123',
        token: 'secret-token',
        csrf: 'csrf-token',
        session: 'session-id',
        email: 'test@example.com',
      },
      elapsedMs: 200,
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    const body = saved.phases[0].response.body
    // Raw body preserved — write-action fixture goes to gitignored fixture/
    expect(body.success).toBe(true)
    expect(body.readlistBookId).toBe('789')
    expect(body.bookId).toBe('123')
    expect(body.token).toBe('secret-token')
    expect(body.csrf).toBe('csrf-token')
    expect(body.session).toBe('session-id')
    expect(body.email).toBe('test@example.com')
  })

  it('stores raw response body for delete operation', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'delete-book-id', booklistName: 'test', bookId: '999', fixtureDir: tmpDir })
    r.recordApiPhase('removeBook', {
      method: 'GET',
      url: '/papi/booklist/42/remove-book/999',
      httpStatus: 200,
      body: { success: true, error: null },
      elapsedMs: 200,
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    const body = saved.phases[0].response.body
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('error')
  })

  it('stores raw response body with mappings for resolveReadlistBookId', () => {
    const r = new ManageMutationTraceRecorder({ enabled: true, operation: 'delete-book-id', booklistName: 'test', bookId: '123', fixtureDir: tmpDir })
    r.recordApiPhase('resolveReadlistBookId', {
      method: 'GET',
      url: '/papi/booklist/book-id-list?booklistId=42',
      httpStatus: 200,
      body: {
        success: true,
        mappings: [
          { readlistBookId: 10, bookId: '999', title: 'Other Book' },
        ],
        matched: 0,
        token: 'should-be-stripped',
      },
      elapsedMs: 100,
    })

    const filepath = r.save()
    const saved = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
    const body = saved.phases[0].response.body
    // Raw body preserved — token is included (gitignored fixture, no sanitize)
    expect(body).toHaveProperty('mappings')
    expect(body).toHaveProperty('matched')
    expect(body.matched).toBe(0)
    expect(Array.isArray(body.mappings)).toBe(true)
    expect(body.mappings[0].readlistBookId).toBe(10)
    expect(body.token).toBe('should-be-stripped')
  })
})
